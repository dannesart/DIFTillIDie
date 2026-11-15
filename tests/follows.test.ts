import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { parse } from 'vue/compiler-sfc'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStore } from '../app/lib/auth'
import { createFollows, followErrorMessage, followsMissing } from '../app/lib/follows'

/* Following supporters (#9): the browser store. The database's own rules are tested in follows-db.test.ts. */

const MATTIAS = '55555555-5555-4555-8555-555555555555'
const JARN = '44444444-4444-4444-8444-444444444444'
const LOTTA = '11111111-1111-4111-8111-111111111111'

type R = { data?: unknown, error?: unknown }
const done = (r: R) => ({ data: r.data ?? null, error: r.error ?? null })

function fakeClient(o: { row?: R, follow?: R | (() => R | Promise<R>), unfollow?: R, list?: R, counts?: R | (() => R) } = {}) {
  const calls: { op: string, args?: unknown }[] = []
  const client = {
    async rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ op: `rpc:${fn}`, args })
      if (fn === 'follow_supporter') return done(typeof o.follow === 'function' ? await o.follow() : o.follow ?? { data: true })
      if (fn === 'unfollow_supporter') return done(o.unfollow ?? { data: true })
      if (fn === 'followed_supporters') return done(o.list ?? { data: [] })
      if (fn === 'supporter_follow_counts') return done(typeof o.counts === 'function' ? o.counts() : o.counts ?? { data: [] })
      throw new Error('unknown rpc')
    },
    from(table: string) {
      expect(table).toBe('supporter_follows')
      return {
        select: () => ({
          eq: (_c: string, id: string) => ({ maybeSingle: async () => { calls.push({ op: 'row', args: id }); return done(o.row ?? { data: null }) } }),
        }),
      }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

function fakeAuth(state: { status?: string, profileStatus?: string, userId?: string | null } = {}) {
  return {
    status: ref(state.status ?? 'signed-in'),
    profileStatus: ref(state.profileStatus ?? 'ready'),
    userId: ref(state.userId === undefined ? MATTIAS : state.userId),
  } as unknown as AuthStore
}

describe('whether following is there at all', () => {
  it('signed out: asks nothing (follows aren\'t readable signed out), and "Följ" can show', async () => {
    const { client, calls } = fakeClient()
    const f = createFollows(client, fakeAuth({ status: 'signed-out', userId: null }))
    await f.check(JARN)
    expect(f.status.value).toBe('ready')
    expect(calls).toEqual([])
  })

  it('a database without the migration: unavailable, and nothing more is asked', async () => {
    const { client, calls } = fakeClient({ row: { error: { code: 'PGRST205' } } })
    const f = createFollows(client, fakeAuth())
    await f.check(JARN)
    expect(f.status.value).toBe('unavailable')
    expect(f.listStatus.value).toBe('unavailable')
    await f.check(LOTTA)
    await f.loadList()
    expect(calls).toHaveLength(1)
  })

  it('recognises a missing table or function', () => {
    for (const code of ['42P01', 'PGRST205', '42883', 'PGRST202']) expect(followsMissing({ code })).toBe(true)
    expect(followsMissing({ code: '42501' })).toBe(false)
  })
})

describe('following and unfollowing', () => {
  it('reads whether you follow someone from your own rows', async () => {
    const { client, calls } = fakeClient({ row: { data: { followed_id: JARN } } })
    const f = createFollows(client, fakeAuth())
    expect(JARN in f.following.value).toBe(false) // not known yet
    await f.check(JARN)
    expect(f.following.value[JARN]).toBe(true)
    expect(calls).toEqual([{ op: 'row', args: JARN }])
  })

  it('a failed lookup never leaves the button stuck: the supporter is known, as not followed, and can be followed', async () => {
    let fail = false
    const { client } = fakeClient({ row: { data: null } })
    // After a first supporter worked (the store is 'ready'), the next lookup fails…
    const f = createFollows(client, fakeAuth())
    await f.check(JARN)
    expect(f.status.value).toBe('ready')
    ;(client as unknown as { from: (t: string) => unknown }).from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (fail = true, { data: null, error: { code: 'XX000' } }) }) }) })
    await f.check(LOTTA)
    expect(fail).toBe(true)
    // …and Lotta's state is still settled (not "unknown", which kept the button disabled)
    expect(LOTTA in f.following.value).toBe(true)
    expect(f.following.value[LOTTA]).toBe(false)
    expect(f.status.value).toBe('ready')
    // Tapping follows; following is idempotent, so this is safe even if she was followed already
    expect(await f.toggle(LOTTA)).toEqual({ ok: true })
    expect(f.following.value[LOTTA]).toBe(true)
  })

  it('a failed very first lookup keeps the button (not hidden by an error status)', async () => {
    const { client } = fakeClient({ row: { error: { code: 'XX000' } } })
    const f = createFollows(client, fakeAuth())
    await f.check(JARN)
    expect(f.status.value).toBe('ready')
    expect(f.following.value[JARN]).toBe(false)
  })

  it('"Följer" only once Supabase has confirmed it', async () => {
    let release!: (r: R) => void
    const { client, calls } = fakeClient({ follow: () => new Promise<R>(r => (release = r)) })
    const f = createFollows(client, fakeAuth())
    const tap = f.toggle(JARN)
    await nextTick()
    expect(f.pending.value[JARN]).toBe(true)
    expect(f.following.value[JARN]).toBeUndefined()
    // A second tap meanwhile does nothing
    expect(await f.toggle(JARN)).toEqual({ ok: false, message: 'Ett ögonblick…' })
    release({ data: true })
    expect(await tap).toEqual({ ok: true })
    expect(f.following.value[JARN]).toBe(true)
    expect(f.pending.value[JARN]).toBeUndefined()
    // One follow (then only a read of their counts, tested under "public follow counts")
    expect(calls.filter(c => c.op.startsWith('rpc') && c.op !== 'rpc:supporter_follow_counts')).toEqual([{ op: 'rpc:follow_supporter', args: { p_profile_id: JARN } }])
  })

  it('tapping "Följer" unfollows, and they leave your list at once', async () => {
    const { client, calls } = fakeClient({ list: { data: [{ id: JARN, display_name: 'Järnmannen', handle: 'jarnmannen', avatar: null }] } })
    const f = createFollows(client, fakeAuth())
    await f.loadList()
    expect(f.following.value[JARN]).toBe(true)
    expect(await f.toggle(JARN)).toEqual({ ok: true })
    expect(calls.filter(c => c.op !== 'rpc:supporter_follow_counts').at(-1)).toEqual({ op: 'rpc:unfollow_supporter', args: { p_profile_id: JARN } })
    expect(f.following.value[JARN]).toBe(false)
    expect(f.list.value).toEqual([])
  })

  it('a refusal changes nothing and says why — the same words for a private or missing supporter', async () => {
    const { client } = fakeClient({ follow: { error: { code: 'P0002', message: 'No public supporter' } } })
    const f = createFollows(client, fakeAuth())
    expect(await f.toggle(LOTTA)).toEqual({ ok: false, message: 'Den här supportern går inte att följa just nu.' })
    expect(f.following.value[LOTTA]).toBeUndefined()
  })

  it('signed out or without a name: refused before asking the database', async () => {
    for (const auth of [fakeAuth({ status: 'signed-out', userId: null }), fakeAuth({ profileStatus: 'missing' })]) {
      const { client, calls } = fakeClient()
      const f = createFollows(client, auth)
      expect((await f.toggle(JARN)).ok).toBe(false)
      expect(calls).toEqual([])
    }
  })

  it('the migration missing at the moment you tap: unavailable from then on', async () => {
    const { client } = fakeClient({ follow: { error: { code: 'PGRST202' } } })
    const f = createFollows(client, fakeAuth())
    expect((await f.toggle(JARN)).ok).toBe(false)
    expect(f.status.value).toBe('unavailable')
  })

  it('error words', () => {
    expect(followErrorMessage({ code: '23514' })).toBe('Du kan inte följa dig själv.')
    expect(followErrorMessage({ code: '42501' })).toMatch(/Logga in/)
    expect(followErrorMessage({ code: 'XX000' })).toBe('Det gick inte. Försök igen.')
  })
})

describe('your list, and whose it is', () => {
  it('"Du följer" shows the public supporters the database returns, as they are', async () => {
    const { client } = fakeClient({ list: { data: [
      { id: JARN, display_name: 'Järnmannen', handle: 'jarnmannen', avatar: 'halsduk' },
      { id: LOTTA, display_name: 'Lotta', handle: 'lotta_g', avatar: 'nonsense' },
    ] } })
    const f = createFollows(client, fakeAuth())
    await f.loadList()
    expect(f.listStatus.value).toBe('ready')
    expect(f.list.value).toEqual([
      { id: JARN, name: 'Järnmannen', handle: 'jarnmannen', avatar: 'halsduk' },
      { id: LOTTA, name: 'Lotta', handle: 'lotta_g', avatar: null }, // an unknown design isn't invented
    ])
  })

  it('a failed list says so, and keeps no made-up entries', async () => {
    const { client } = fakeClient({ list: { error: { code: 'XX000' } } })
    const f = createFollows(client, fakeAuth())
    await f.loadList()
    expect(f.listStatus.value).toBe('error')
    expect(f.list.value).toEqual([])
  })

  it('belongs to whoever is signed in: forgotten when that changes', async () => {
    const auth = fakeAuth()
    const { client } = fakeClient({ list: { data: [{ id: JARN, display_name: 'Järnmannen', handle: 'jarnmannen', avatar: null }] } })
    const f = createFollows(client, auth)
    await f.loadList()
    auth.userId.value = LOTTA
    await nextTick()
    expect(f.list.value).toEqual([])
    expect(f.following.value).toEqual({})
    expect(f.listStatus.value).toBe('idle')
  })
})

describe('public follow counts', () => {
  it('shows exactly what the database returned, even signed out', async () => {
    const { client, calls } = fakeClient({ counts: { data: [{ followers: 45, following: 65 }] } })
    const f = createFollows(client, fakeAuth({ status: 'signed-out', userId: null }))
    await f.loadCounts(JARN)
    expect(f.counts.value[JARN]).toEqual({ followers: 45, following: 65 })
    expect(calls).toEqual([{ op: 'rpc:supporter_follow_counts', args: { p_profile_id: JARN } }])
  })

  it('no row (a private or missing supporter): nothing, not zeros', async () => {
    const { client } = fakeClient({ counts: { data: [] } })
    const f = createFollows(client, fakeAuth())
    await f.loadCounts(MATTIAS)
    expect(MATTIAS in f.counts.value).toBe(false)
  })

  it('a failed lookup or a malformed answer: nothing shown, and an earlier number isn\'t kept as if current', async () => {
    let answer: R = { data: [{ followers: 3, following: 1 }] }
    const { client } = fakeClient({ counts: () => answer })
    const f = createFollows(client, fakeAuth())
    await f.loadCounts(JARN)
    expect(f.counts.value[JARN]).toEqual({ followers: 3, following: 1 })
    answer = { error: { code: 'XX000' } }
    await f.loadCounts(JARN)
    expect(JARN in f.counts.value).toBe(false)
    answer = { data: [{ followers: '3', following: -1 }] }
    await f.loadCounts(JARN)
    expect(JARN in f.counts.value).toBe(false)
  })

  it('a database without the function: hidden, and not asked again', async () => {
    const { client, calls } = fakeClient({ counts: { error: { code: 'PGRST202' } } })
    const f = createFollows(client, fakeAuth())
    await f.loadCounts(JARN)
    await f.loadCounts(LOTTA)
    expect(f.counts.value).toEqual({})
    expect(calls.filter(c => c.op === 'rpc:supporter_follow_counts')).toHaveLength(1)
    // Following itself is unaffected
    expect(f.status.value).not.toBe('unavailable')
  })

  it('after a follow or unfollow, their counts are asked for again (never nudged locally)', async () => {
    let followers = 2
    const { client, calls } = fakeClient({ counts: () => ({ data: [{ followers, following: 0 }] }), follow: () => (followers++, { data: true }) })
    const f = createFollows(client, fakeAuth())
    await f.loadCounts(JARN)
    expect(await f.toggle(JARN)).toEqual({ ok: true })
    await nextTick(); await Promise.resolve()
    expect(calls.filter(c => c.op === 'rpc:supporter_follow_counts')).toHaveLength(2)
    expect(f.counts.value[JARN]).toEqual({ followers: 3, following: 0 })
  })

  it('a refused follow doesn\'t ask again', async () => {
    const { client, calls } = fakeClient({ follow: { error: { code: 'P0002' } } })
    const f = createFollows(client, fakeAuth())
    await f.toggle(JARN)
    expect(calls.filter(c => c.op === 'rpc:supporter_follow_counts')).toHaveLength(0)
  })

  it('forgotten when someone else signs in (your own private place\'s counts were yours only)', async () => {
    const auth = fakeAuth()
    const { client } = fakeClient({ counts: { data: [{ followers: 0, following: 1 }] } })
    const f = createFollows(client, auth)
    await f.loadCounts(MATTIAS)
    auth.userId.value = LOTTA
    await nextTick()
    expect(f.counts.value).toEqual({})
  })
})

describe('the läktarplats', () => {
  type Prop = { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }
  type Node = { type: number, tag?: string, props?: Prop[], children?: Node[], content?: string }
  const ast = parse(readFileSync('app/components/SupporterPlace.vue', 'utf8')).descriptor.template!.ast as unknown as Node
  const all = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(all)]
  const dir = (n: Node, name: string) => n.props?.find(p => p.type === 7 && (p.arg?.content === name || p.name === name))?.exp?.content

  it('the follow button: never on your own place, pressed when you follow, busy while it\'s being saved', () => {
    const button = all(ast).find(n => n.tag === 'button' && dir(n, 'click') === 'tapFollow')!
    expect(dir(button, 'if')).toBe('showFollow')
    expect(readFileSync('app/components/SupporterPlace.vue', 'utf8')).toMatch(/showFollow = computed\(\(\) => !own\.value/)
    expect(dir(button, 'aria-pressed')).toBe('followingThem')
    expect(dir(button, 'disabled')).toBe('followBusy')
    expect(dir(button, 'aria-busy')).toBe('followBusy')
  })

  it('"Du följer" is only on your own place', () => {
    const section = all(ast).find(n => n.tag === 'section' && n.props?.some(p => p.name === 'aria-labelledby' && p.value?.content === 'i-follow'))!
    expect(dir(section, 'if')).toMatch(/^own && /)
  })
})
