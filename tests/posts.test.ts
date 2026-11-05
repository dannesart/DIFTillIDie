import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStore } from '../app/lib/auth'
import type { Story } from '../shared/types/domain'
import { POST_MAX, STORY_UNVERIFIED, createCommunity, frozenLead, normalizePostBody, postLength, publishErrorMessage, toCommunityPost, validatePostBody } from '../app/lib/posts'

const HASSE = '22222222-2222-4222-8222-222222222222'
const LOTTA = '11111111-1111-4111-8111-111111111111'

const row = (id: string, body: string, author = { id: HASSE, display_name: 'Hovet-Hasse', handle: 'hovethasse' }, extra: Record<string, unknown> = {}) =>
  ({ id, body, sport: null, story_id: null, created_at: '2026-11-03T12:00:00Z', author, ...extra })

/* A fake Supabase client: just the Data API calls the store makes, all recorded. */
function fakeClient(opts: {
  list?: { data?: unknown, error?: unknown } | (() => { data?: unknown, error?: unknown })
  insert?: { data?: unknown, error?: unknown } | ((values: Record<string, unknown>, cols: string) => { data?: unknown, error?: unknown })
  remove?: { data?: unknown, error?: unknown }
  throwOnInsert?: unknown
} = {}) {
  const calls: { op: string, args: unknown[] }[] = []
  const settle = <T>(v: T) => Promise.resolve(v)
  const client = {
    // publish_post(): the one way to publish.
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ op: 'rpc', args: [fn, args] })
      return {
        select: (cols: string) => ({
          single: async () => {
            calls.push({ op: 'rpc.select', args: [cols] })
            if (opts.throwOnInsert) throw opts.throwOnInsert
            const r = typeof opts.insert === 'function' ? opts.insert(args, cols) : opts.insert ?? { data: row('new-1', String(args.p_body)) }
            return { data: r.data ?? null, error: r.error ?? null }
          },
        }),
      }
    },
    from(table: string) {
      calls.push({ op: 'from', args: [table] })
      return {
        select(cols: string) {
          calls.push({ op: 'select', args: [cols] })
          const q = {
            order(col: string, o: unknown) { calls.push({ op: 'order', args: [col, o] }); return q },
            limit(n: number) {
              calls.push({ op: 'limit', args: [n] })
              const r = typeof opts.list === 'function' ? opts.list() : opts.list ?? { data: [] }
              return settle({ data: r.data ?? null, error: r.error ?? null })
            },
          }
          return q
        },
        insert(values: Record<string, unknown>) {
          calls.push({ op: 'insert', args: [values] })
          return {
            select: (cols: string) => ({
              single: async () => {
                calls.push({ op: 'insert.select', args: [cols] })
                if (opts.throwOnInsert) throw opts.throwOnInsert
                const r = typeof opts.insert === 'function' ? opts.insert(values) : opts.insert ?? { data: row('new-1', String(values.body)) }
                return { data: r.data ?? null, error: r.error ?? null }
              },
            }),
          }
        },
        delete() {
          calls.push({ op: 'delete', args: [] })
          return {
            eq: (col: string, v: string) => ({
              select: async () => {
                calls.push({ op: 'delete.eq', args: [col, v] })
                const r = opts.remove ?? { data: [{ id: v }] }
                return { data: r.data ?? null, error: r.error ?? null }
              },
            }),
          }
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

function fakeAuth(state: { status?: string, profileStatus?: string, profile?: { id: string, displayName: string, handle: string } | null } = {}) {
  return {
    status: ref(state.status ?? 'signed-in'),
    profileStatus: ref(state.profileStatus ?? 'ready'),
    profile: ref(state.profile === undefined ? { id: HASSE, displayName: 'Hovet-Hasse', handle: 'hovethasse' } : state.profile),
    userId: ref(HASSE),
  } as unknown as AuthStore
}

describe('reading the real feed (public, no sign-in needed)', () => {
  it('starts idle, then shows exactly what Supabase returned, newest first as requested', async () => {
    const { client, calls } = fakeClient({ list: { data: [row('b', 'Senare'), row('a', 'Tidigare', { id: LOTTA, display_name: 'Lotta', handle: 'kaminen81' })] } })
    const c = createCommunity(client, null)
    expect(c.status.value).toBe('idle')
    const p = c.refresh()
    expect(c.status.value).toBe('loading')
    await p
    expect(c.status.value).toBe('ready')
    expect(c.posts.value.map(x => [x.body, x.author.handle])).toEqual([['Senare', 'hovethasse'], ['Tidigare', 'kaminen81']])
    expect(calls.find(x => x.op === 'order')!.args).toEqual(['created_at', { ascending: false }])
    // Only public author fields are asked for.
    expect(calls.find(x => x.op === 'select')!.args[0]).toMatch(/author:profiles!posts_author_id_fkey\(id, display_name, handle, avatar\)/)
  })

  it('works signed out: no auth store needed to read', async () => {
    const { client } = fakeClient({ list: { data: [row('a', 'Hej')] } })
    const c = createCommunity(client, null)
    await c.refresh()
    expect(c.posts.value).toHaveLength(1)
  })

  it('an empty feed is ready and empty, not an error', async () => {
    const c = createCommunity(fakeClient({ list: { data: [] } }).client, null)
    await c.refresh()
    expect([c.status.value, c.posts.value]).toEqual(['ready', []])
  })

  it('a failed first load is an error; a failed refresh keeps the posts and says they may be stale', async () => {
    let fail = true
    const c = createCommunity(fakeClient({ list: () => (fail ? { error: { message: 'TypeError: Failed to fetch' } } : { data: [row('a', 'Hej')] }) }).client, null)
    await c.refresh()
    expect(c.status.value).toBe('error')
    fail = false
    await c.refresh()
    expect([c.status.value, c.stale.value]).toEqual(['ready', false])
    fail = true
    await c.refresh()
    expect([c.status.value, c.stale.value, c.posts.value.length]).toEqual(['ready', true, 1])
  })

  it('skips rows without a visible author rather than inventing one', () => {
    expect(toCommunityPost(row('a', 'Hej', null as never))).toBeNull()
    expect(toCommunityPost(row('a', 'Hej', [{ id: HASSE, display_name: 'H', handle: 'hh' }] as never))!.author.handle).toBe('hh')
  })

  it('without Supabase configured, it is unavailable and never calls anything', async () => {
    const c = createCommunity(null, null)
    expect(c.status.value).toBe('unavailable')
    await c.refresh()
    expect(c.status.value).toBe('unavailable')
  })
})

const STORY = { id: 'story-x', sport: 'fotboll', sources: [], leadId: 'x', sharedNames: [], updatedAt: '', capture: { data: '{"storyId":"story-x"}', sig: 'ab12' } } satisfies Story

describe('publishing', () => {
  it('a database without the avatar column yet (regression): published once, under its author', async () => {
    const { client, calls } = fakeClient({
      // publish_post() and what it returns are one statement, so the 42703 published nothing.
      insert: (args, cols) => (cols.includes('avatar') ? { error: { code: '42703', message: 'column profiles_1.avatar does not exist' } } : { data: row('new-1', String(args.p_body)) }),
    })
    const c = createCommunity(client, fakeAuth())
    const r = await c.publish({ body: 'Snyggt!' })
    expect(r.ok).toBe(true)
    expect(calls.filter(x => x.op === 'rpc.select').map(x => String(x.args[0]).includes('avatar'))).toEqual([true, false])
    expect(c.posts.value.map(p => [p.body, p.author.handle, p.author.avatar])).toEqual([['Snyggt!', 'hovethasse', null]])
  })

  it('any other failure is not retried', async () => {
    const { client, calls } = fakeClient({ insert: { error: { code: '42501', message: 'permission denied' } } })
    const r = await createCommunity(client, fakeAuth()).publish({ body: 'Hej' })
    expect(r.ok).toBe(false)
    expect(calls.filter(x => x.op === 'rpc')).toHaveLength(1)
  })

  it('a Story without a signed capture is never sent, and the text stays', async () => {
    const { client, calls } = fakeClient()
    const r = await createCommunity(client, fakeAuth()).publish({ body: 'Hej', story: { ...STORY, capture: undefined } })
    expect(r).toEqual({ ok: false, message: STORY_UNVERIFIED })
    expect(calls.some(x => x.op === 'rpc')).toBe(false)
  })

  it('a capture the database won’t verify: says so, and the text stays', async () => {
    const c = createCommunity(fakeClient({ insert: { error: { code: '22023', message: 'story capture not verified' } } }).client, fakeAuth())
    expect(await c.publish({ body: 'Hej', story: STORY })).toEqual({ ok: false, message: STORY_UNVERIFIED })
    expect(STORY_UNVERIFIED).toMatch(/finns kvar/)
  })

  it('a database without the supporter-profiles migration yet: the feed still loads, without avatars', async () => {
    let n = 0
    const { client, calls } = fakeClient({ list: () => (n++ ? { data: [row('a', 'Hej')] } : { error: { code: '42703', message: 'column profiles_1.avatar does not exist' } }) })
    const c = createCommunity(client, fakeAuth())
    await c.refresh()
    expect([c.status.value, c.posts.value.map(p => [p.body, p.author.avatar])]).toEqual(['ready', [['Hej', null]]])
    const selects = calls.filter(x => x.op === 'select').map(x => String(x.args[0]))
    expect([selects[0]!.includes('avatar'), selects[1]!.includes('avatar'), selects[1]!.includes('story_ref')]).toEqual([true, false, true])
  })

  it('reads the frozen Story back, and ignores one it can’t show', () => {
    const frozen = { v: 1, kid: 'k', storyId: 'story-x', leadKey: 'b', sources: [{ key: 'a', headline: 'Ett', url: 'https://e.se/1', outlet: 'X' }, { key: 'b', headline: 'Två', url: 'https://e.se/2', outlet: 'Y' }] }
    const p = toCommunityPost(row('a', 'Hej', undefined, { story_id: 'story-x', story_ref: frozen }) as never)!
    expect(p.storyRef).toEqual(frozen)
    expect(frozenLead(p.storyRef!).headline).toBe('Två')
    expect(toCommunityPost(row('b', 'Hej', undefined, { story_id: 'story-x', story_ref: { sources: [] } }) as never)!.storyRef).toBeUndefined()
    expect(toCommunityPost(row('c', 'Hej', undefined, { story_id: 'story-x' }) as never)!.storyRef).toBeUndefined()
  })

  it('sends only body, sport and the Story’s signed capture — never an author — and shows the post only once Supabase confirms it', async () => {
    let resolveInsert!: () => void
    const gate = new Promise<void>(r => (resolveInsert = r))
    const { client, calls } = fakeClient()
    const c = createCommunity(client, fakeAuth())
    // Hold the call until we've checked nothing was shown early.
    const orig = client.rpc
    ;(client as unknown as { rpc: typeof orig }).rpc = (fn: string, args: Record<string, unknown>) =>
      ({ select: (cols: string) => ({ single: async () => { await gate; return orig.call(client, fn, args).select(cols).single() } }) }) as never
    const pending = c.publish({ body: '  Järnkaminen brinner!  ', sport: 'hockey', story: STORY })
    await nextTick()
    expect(c.publishing.value).toBe(true)
    expect(c.posts.value).toEqual([])
    resolveInsert()
    const r = await pending
    expect(r.ok).toBe(true)
    expect(calls.find(x => x.op === 'rpc')!.args).toEqual(['publish_post', { p_body: 'Järnkaminen brinner!', p_sport: 'hockey', p_story: '{"storyId":"story-x"}', p_story_sig: 'ab12' }])
    expect(c.posts.value.map(p => p.body)).toEqual(['Järnkaminen brinner!'])
    expect(c.publishing.value).toBe(false)
  })

  it('a failure leaves the feed untouched and says the text is kept', async () => {
    const c = createCommunity(fakeClient({ insert: { error: { code: '42501', message: 'new row violates row-level security policy' } } }).client, fakeAuth())
    const r = await c.publish({ body: 'Hej' })
    expect(r).toEqual({ ok: false, message: expect.stringContaining('finns kvar') })
    expect(c.posts.value).toEqual([])
  })

  it('a network failure (thrown) is handled the same way', async () => {
    const c = createCommunity(fakeClient({ throwOnInsert: new TypeError('Failed to fetch') }).client, fakeAuth())
    const r = await c.publish({ body: 'Hej' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/Ingen kontakt.*finns kvar/)
    expect(c.publishing.value).toBe(false)
  })

  it('needs a signed-in supporter with a ready profile, checked before any request', async () => {
    for (const auth of [fakeAuth({ status: 'signed-out' }), fakeAuth({ profileStatus: 'missing', profile: null }), null]) {
      const { client, calls } = fakeClient()
      const r = await createCommunity(client, auth).publish({ body: 'Hej' })
      expect(r.ok).toBe(false)
      expect(calls.some(x => x.op === 'rpc')).toBe(false)
    }
  })

  it('validates before any request: empty, whitespace, too long', async () => {
    const { client, calls } = fakeClient()
    const c = createCommunity(client, fakeAuth())
    for (const body of ['', '   \n ', 'x'.repeat(POST_MAX + 1)]) expect((await c.publish({ body })).ok).toBe(false)
    expect(calls.some(x => x.op === 'rpc')).toBe(false)
    expect((await c.publish({ body: '💙'.repeat(POST_MAX) })).ok).toBe(true)
  })

  it('ignores a second publish while one is in flight', async () => {
    const { client, calls } = fakeClient()
    const c = createCommunity(client, fakeAuth())
    const [a, b] = await Promise.all([c.publish({ body: 'Ett' }), c.publish({ body: 'Två' })])
    expect([a.ok, b.ok]).toEqual([true, false])
    expect(calls.filter(x => x.op === 'rpc')).toHaveLength(1)
  })

  it('own posts follow a profile edit at once', async () => {
    const auth = fakeAuth()
    const c = createCommunity(fakeClient({ list: { data: [row('a', 'Hej'), row('b', 'Lottas', { id: LOTTA, display_name: 'Lotta', handle: 'kaminen81' })] } }).client, auth)
    await c.refresh()
    auth.profile.value = { id: HASSE, displayName: 'Hasse i Hjorthagen', handle: 'hjorthagen' }
    await nextTick()
    expect(c.posts.value.map(p => p.author.handle)).toEqual(['hjorthagen', 'kaminen81'])
  })
})

describe('deleting', () => {
  it('removes your own post once Supabase confirms', async () => {
    const { client } = fakeClient({ list: { data: [row('a', 'Hej')] } })
    const c = createCommunity(client, fakeAuth())
    await c.refresh()
    expect(await c.remove('a')).toEqual({ ok: true })
    expect(c.posts.value).toEqual([])
  })

  it('when the database deletes nothing (not yours), the post stays and you are told', async () => {
    const c = createCommunity(fakeClient({ list: { data: [row('a', 'Hej')] }, remove: { data: [] } }).client, fakeAuth())
    await c.refresh()
    expect((await c.remove('a')).ok).toBe(false)
    expect(c.posts.value).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('normalizes like the database expects', () => {
    expect(normalizePostBody('  Hej\r\nhopp\t!\u0007  ')).toBe('Hej\nhopp !')
    expect(validatePostBody('')).toMatch(/Skriv/)
    expect(validatePostBody('x'.repeat(281))).toMatch(/280/)
    expect(postLength('💙💙')).toBe(2)
  })

  it('maps database errors to calm Swedish messages', () => {
    expect(publishErrorMessage({ code: '42501' })).toMatch(/kan inte publicera/)
    expect(publishErrorMessage({ code: '23503' })).toMatch(/kan inte publicera/)
    expect(publishErrorMessage({ code: '23514' })).toMatch(/1–280/)
    expect(publishErrorMessage({ code: 'PGRST301', message: 'JWT expired' })).toMatch(/Logga in igen/)
    expect(publishErrorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/Ingen kontakt/)
    expect(publishErrorMessage(undefined)).toMatch(/finns kvar/)
  })
})
