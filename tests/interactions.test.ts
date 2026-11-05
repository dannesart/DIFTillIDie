import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStore } from '../app/lib/auth'
import type { CommunityStore } from '../app/lib/posts'
import { COMMENT_LIMIT, commentErrorMessage, createInteractions, reactErrorMessage, toRealComment } from '../app/lib/interactions'

const MATTIAS = '55555555-5555-4555-8555-555555555555'
const JARN = '44444444-4444-4444-8444-444444444444'
const P1 = 'post-1'

type R = { data?: unknown, error?: unknown }
const comment = (id: string, body: string, author = { id: MATTIAS, display_name: 'Mattias', handle: 'mattias' }) =>
  ({ id, post_id: P1, body, created_at: '2026-11-04T12:00:00Z', author })

/* A fake Supabase client for the calls the store makes, all recorded. */
function fakeClient(o: {
  stats?: R | (() => R)
  setReaction?: (args: { p_post_id: string, p_reaction: string | null }) => R | Promise<R>
  mine?: R
  comments?: R | (() => R)
  insertComment?: R | ((v: Record<string, unknown>, cols: string) => R)
  deleteComment?: R
} = {}) {
  const calls: { op: string, args: unknown }[] = []
  const val = <T>(x: T | (() => T) | undefined, d: T) => (typeof x === 'function' ? (x as () => T)() : x ?? d)
  const done = (r: R) => ({ data: r.data ?? null, error: r.error ?? null })
  const client = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ op: `rpc:${fn}`, args })
      if (fn === 'post_stats') return done(val(o.stats, { data: [] }))
      if (fn === 'set_post_reaction') return done(await (o.setReaction ?? (() => ({ data: null })))(args as never))
      throw new Error('unknown rpc')
    },
    from(table: string) {
      if (table === 'post_reactions') {
        return { select: () => ({ in: async (_c: string, ids: string[]) => { calls.push({ op: 'mine', args: ids }); return done(o.mine ?? { data: [] }) } }) }
      }
      return {
        select: () => {
          const q = { eq: () => q, order: () => q, limit: async () => { calls.push({ op: 'comments', args: null }); return done(val(o.comments, { data: [] })) } }
          return q
        },
        insert: (v: Record<string, unknown>) => {
          calls.push({ op: 'insertComment', args: v })
          return { select: (cols: string) => ({ single: async () => { calls.push({ op: 'insertComment.select', args: cols }); return done(typeof o.insertComment === 'function' ? o.insertComment(v, cols) : o.insertComment ?? { data: comment('c-new', String(v.body)) }) } }) }
        },
        delete: () => ({ eq: (_c: string, id: string) => ({ select: async () => { calls.push({ op: 'deleteComment', args: id }); return done(o.deleteComment ?? { data: [{ id }] }) } }) }),
      }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

function fakeAuth(state: { status?: string, profileStatus?: string, userId?: string | null } = {}) {
  return {
    status: ref(state.status ?? 'signed-in'),
    profileStatus: ref(state.profileStatus ?? 'ready'),
    profile: ref(state.profileStatus === 'missing' ? null : { id: state.userId ?? MATTIAS, displayName: 'Mattias', handle: 'mattias' }),
    userId: ref(state.userId === undefined ? MATTIAS : state.userId),
  } as unknown as AuthStore
}
const fakeCommunity = (ids: string[]) => ({ posts: ref(ids.map(id => ({ id }))) }) as unknown as CommunityStore
const flush = () => new Promise(r => setTimeout(r, 0))

describe('totals and your own reaction', () => {
  it('loads public totals for the feed’s posts, and zeros for posts nobody reacted to', async () => {
    const { client, calls } = fakeClient({ stats: { data: [{ post_id: P1, hjarta: 3, eld: 1, stjarna: 0, tarar: 0, comments: 2 }] } })
    const i = createInteractions(client, null, null)
    await i.loadStats([P1, 'post-2'])
    expect(i.stats.value[P1]).toEqual({ reactions: { hjarta: 3, eld: 1, stjarna: 0, tarar: 0 }, comments: 2 })
    expect(i.stats.value['post-2']!.comments).toBe(0)
    expect(calls[0]).toEqual({ op: 'rpc:post_stats', args: { p_post_ids: [P1, 'post-2'] } })
  })

  it('signed out, never asks for reaction rows', async () => {
    const { client, calls } = fakeClient()
    const i = createInteractions(client, fakeAuth({ status: 'signed-out', userId: null }), null)
    await i.loadMine([P1])
    expect(calls.some(c => c.op === 'mine')).toBe(false)
  })

  it('a failed first load is an error; later failures keep the totals', async () => {
    let fail = true
    const i = createInteractions(fakeClient({ stats: () => (fail ? { error: { message: 'Failed to fetch' } } : { data: [{ post_id: P1, hjarta: 1, eld: 0, stjarna: 0, tarar: 0, comments: 0 }] }) }).client, null, null)
    await i.loadStats([P1])
    expect(i.statsStatus.value).toBe('error')
    fail = false
    await i.loadStats([P1])
    fail = true
    await i.loadStats([P1])
    expect([i.statsStatus.value, i.stats.value[P1]!.reactions.hjarta]).toEqual(['ready', 1])
  })

  it('reloads totals and your reactions when the feed changes, and forgets them on sign-out', async () => {
    const auth = fakeAuth()
    const community = fakeCommunity([P1])
    const { client, calls } = fakeClient({ mine: { data: [{ post_id: P1, reaction: 'eld' }] } })
    const i = createInteractions(client, auth, community)
    community.posts.value = [...community.posts.value] as never
    await nextTick(); await flush()
    expect(i.mine.value).toEqual({ [P1]: 'eld' })
    expect(calls.filter(c => c.op === 'rpc:post_stats')).toHaveLength(1)
    auth.userId.value = null
    await nextTick(); await flush()
    expect(i.mine.value).toEqual({})
  })
})

describe('reacting', () => {
  const ready = (o: Parameters<typeof fakeClient>[0] = {}) => {
    const f = fakeClient(o)
    const i = createInteractions(f.client, fakeAuth(), null)
    i.stats.value = { [P1]: { reactions: { hjarta: 2, eld: 0, stjarna: 0, tarar: 0 }, comments: 0 } }
    return { ...f, i }
  }

  it('adds a reaction once Supabase confirms it', async () => {
    const { i, calls } = ready({ setReaction: () => ({ data: null }) })
    expect((await i.react(P1, 'hjarta')).ok).toBe(true)
    expect(calls.at(-1)).toEqual({ op: 'rpc:set_post_reaction', args: { p_post_id: P1, p_reaction: 'hjarta' } })
    expect([i.mine.value[P1], i.stats.value[P1]!.reactions.hjarta]).toEqual(['hjarta', 3])
  })

  it('tapping the same reaction removes it; another one replaces it', async () => {
    const { i, calls } = ready({ setReaction: a => ({ data: a.p_reaction === null ? 'hjarta' : a.p_reaction === 'eld' ? 'hjarta' : null }) })
    i.mine.value = { [P1]: 'hjarta' }
    await i.react(P1, 'eld')
    expect(i.stats.value[P1]!.reactions).toMatchObject({ hjarta: 1, eld: 1 })
    i.mine.value = { [P1]: 'hjarta' }
    i.stats.value = { [P1]: { reactions: { hjarta: 2, eld: 0, stjarna: 0, tarar: 0 }, comments: 0 } }
    await i.react(P1, 'hjarta')
    expect(calls.at(-1)!.args).toEqual({ p_post_id: P1, p_reaction: null })
    expect([i.mine.value[P1], i.stats.value[P1]!.reactions.hjarta]).toEqual([null, 1])
  })

  it('totals follow what the database says was there before, not what this tab thought', async () => {
    // Another device already switched Mattias to 🔥; this tab still thinks 💙.
    const { i } = ready({ setReaction: () => ({ data: 'eld' }) })
    i.mine.value = { [P1]: 'hjarta' }
    i.stats.value = { [P1]: { reactions: { hjarta: 2, eld: 1, stjarna: 0, tarar: 0 }, comments: 0 } }
    await i.react(P1, 'stjarna')
    expect(i.stats.value[P1]!.reactions).toEqual({ hjarta: 2, eld: 0, stjarna: 1, tarar: 0 })
  })

  it('is pending until confirmed, ignores a second tap meanwhile, and a failure changes nothing', async () => {
    let release!: () => void
    const { i, calls } = ready({ setReaction: () => new Promise<R>((res) => { release = () => res({ error: { code: '', message: 'Failed to fetch' } }) }) })
    const first = i.react(P1, 'hjarta')
    await flush()
    expect(i.pending.value[P1]).toBe(true)
    expect((await i.react(P1, 'eld')).ok).toBe(false)
    expect(i.mine.value[P1]).toBeUndefined()
    release()
    const r = await first
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/Ingen kontakt/) })
    expect([i.pending.value[P1], i.mine.value[P1], i.stats.value[P1]!.reactions.hjarta]).toEqual([undefined, undefined, 2])
    expect(calls.filter(c => c.op === 'rpc:set_post_reaction')).toHaveLength(1)
  })

  it('needs a signed-in supporter with a profile, checked before any request', async () => {
    for (const auth of [fakeAuth({ status: 'signed-out', userId: null }), fakeAuth({ profileStatus: 'missing' }), null]) {
      const { client, calls } = fakeClient()
      expect((await createInteractions(client, auth, null).react(P1, 'hjarta')).ok).toBe(false)
      expect(calls).toEqual([])
    }
  })
})

describe('comments', () => {
  it('loads a post’s comments, oldest first, skipping any without a visible author', async () => {
    const i = createInteractions(fakeClient({ comments: { data: [comment('a', 'Först'), comment('b', 'Sen'), { ...comment('c', 'Spöke'), author: null }] } }).client, null, null)
    await i.loadComments(P1)
    expect(i.threads.value[P1]!.status).toBe('ready')
    expect(i.threads.value[P1]!.list.map(c => c.body)).toEqual(['Först', 'Sen'])
  })

  it('loading a thread never overwrites the total: the list is a capped page, post_stats() is the count', async () => {
    const page = Array.from({ length: COMMENT_LIMIT }, (_, n) => comment(`c${n}`, `Kommentar ${n}`))
    const i = createInteractions(fakeClient({ comments: { data: page } }).client, null, null)
    i.stats.value = { [P1]: { reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: 350 } }
    await i.loadComments(P1)
    expect([i.threads.value[P1]!.list.length, i.threads.value[P1]!.more, i.stats.value[P1]!.comments]).toEqual([COMMENT_LIMIT, true, 350])

    // A complete thread doesn't rewrite it either (e.g. a row without a visible author is skipped).
    const j = createInteractions(fakeClient({ comments: { data: [comment('a', 'Hej'), { ...comment('b', 'Spöke'), author: null }] } }).client, null, null)
    j.stats.value = { [P1]: { reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: 2 } }
    await j.loadComments(P1)
    expect([j.threads.value[P1]!.list.length, j.threads.value[P1]!.more, j.stats.value[P1]!.comments]).toEqual([1, false, 2])
  })

  it('a failed load is an error that can be retried', async () => {
    let fail = true
    const i = createInteractions(fakeClient({ comments: () => (fail ? { error: { message: 'x' } } : { data: [comment('a', 'Hej')] }) }).client, null, null)
    await i.loadComments(P1)
    expect(i.threads.value[P1]!.status).toBe('error')
    fail = false
    await i.loadComments(P1)
    expect(i.threads.value[P1]!.list).toHaveLength(1)
  })

  it('sends only post and body — never an author — and shows the comment once confirmed', async () => {
    const { client, calls } = fakeClient()
    const i = createInteractions(client, fakeAuth(), null)
    i.stats.value = { [P1]: { reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: 4 } }
    expect((await i.addComment(P1, '  Vilken kväll!  ')).ok).toBe(true)
    expect(calls.find(c => c.op === 'insertComment')!.args).toEqual({ post_id: P1, body: 'Vilken kväll!' })
    expect(i.threads.value[P1]!.list.map(c => c.body)).toEqual(['Vilken kväll!'])
    expect(i.stats.value[P1]!.comments).toBe(5)
  })

  it('a failure adds nothing and says the comment is kept', async () => {
    const i = createInteractions(fakeClient({ insertComment: { error: { code: '', message: 'TypeError: Failed to fetch' } } }).client, fakeAuth(), null)
    const r = await i.addComment(P1, 'Hej')
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/Din kommentar finns kvar/) })
    expect(i.threads.value[P1]).toBeUndefined()
  })

  it('a database without the avatar column yet (regression): the comment is saved once, under its author', async () => {
    const { client, calls } = fakeClient({
      // As PostgREST answers: the insert and what it returns are one statement, so the 42703 saved nothing.
      insertComment: (v, cols) => (cols.includes('avatar')
        ? { error: { code: '42703', message: 'column profiles_1.avatar does not exist' } }
        : { data: comment('c-new', String(v.body), { id: MATTIAS, display_name: 'Mattias', handle: 'mattias' }) }),
    })
    const i = createInteractions(client, fakeAuth(), null)
    i.stats.value = { [P1]: { reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: 0 } }
    expect(await i.addComment(P1, 'Snyggt!')).toEqual({ ok: true })
    const selects = calls.filter(c => c.op === 'insertComment.select').map(c => String(c.args))
    expect(selects.map(s => s.includes('avatar'))).toEqual([true, false])
    // The same post and body both times; never an author.
    expect(calls.filter(c => c.op === 'insertComment').map(c => c.args)).toEqual([{ post_id: P1, body: 'Snyggt!' }, { post_id: P1, body: 'Snyggt!' }])
    expect(i.threads.value[P1]!.list).toEqual([expect.objectContaining({ body: 'Snyggt!', author: { id: MATTIAS, name: 'Mattias', handle: 'mattias', avatar: null } })])
    expect(i.stats.value[P1]!.comments).toBe(1)
  })

  it('a genuine failure is not retried, and the comment is kept', async () => {
    for (const error of [{ code: '42501', message: 'new row violates row-level security policy' }, { code: '', message: 'TypeError: Failed to fetch' }]) {
      const { client, calls } = fakeClient({ insertComment: { error } })
      const i = createInteractions(client, fakeAuth(), null)
      const r = await i.addComment(P1, 'Hej')
      expect(r.ok).toBe(false)
      expect(calls.filter(c => c.op === 'insertComment')).toHaveLength(1)
      expect(i.threads.value[P1]).toBeUndefined()
    }
  })

  it('validates and checks the profile before any request', async () => {
    const { client, calls } = fakeClient()
    const i = createInteractions(client, fakeAuth(), null)
    for (const body of ['', '  ', 'x'.repeat(281)]) expect((await i.addComment(P1, body)).ok).toBe(false)
    expect((await createInteractions(client, fakeAuth({ profileStatus: 'missing' }), null).addComment(P1, 'Hej')).ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('deletes your own comment once confirmed; if the database deletes nothing, it stays', async () => {
    const i = createInteractions(fakeClient({ comments: { data: [comment('a', 'Hej')] } }).client, fakeAuth(), null)
    i.stats.value = { [P1]: { reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: 1 } }
    await i.loadComments(P1)
    expect((await i.removeComment(P1, 'a')).ok).toBe(true)
    expect([i.threads.value[P1]!.list.length, i.stats.value[P1]!.comments]).toEqual([0, 0])

    const j = createInteractions(fakeClient({ comments: { data: [comment('a', 'Hej')] }, deleteComment: { data: [] } }).client, fakeAuth(), null)
    await j.loadComments(P1)
    expect((await j.removeComment(P1, 'a')).ok).toBe(false)
    expect(j.threads.value[P1]!.list).toHaveLength(1)
  })

  it('your own comments follow a profile edit at once', async () => {
    const auth = fakeAuth()
    const i = createInteractions(fakeClient({ comments: { data: [comment('a', 'Mitt'), comment('b', 'Järnis', { id: JARN, display_name: 'Järnmannen', handle: 'jarnmannen' })] } }).client, auth, null)
    await i.loadComments(P1)
    auth.profile.value = { id: MATTIAS, displayName: 'Mattias på Söder', handle: 'mattias_s' }
    await nextTick()
    expect(i.threads.value[P1]!.list.map(c => c.author.handle)).toEqual(['mattias_s', 'jarnmannen'])
  })
})

describe('helpers', () => {
  it('maps rows and errors', () => {
    expect(toRealComment({ ...comment('a', 'x'), author: [{ id: MATTIAS, display_name: 'M', handle: 'mm' }] } as never)!.author.handle).toBe('mm')
    expect(reactErrorMessage({ code: '42501' })).toMatch(/kan inte reagera/)
    expect(reactErrorMessage({ code: '23503' })).toMatch(/finns inte längre/)
    expect(reactErrorMessage({ message: 'JWT expired', code: 'PGRST301' })).toMatch(/Logga in igen/)
    expect(commentErrorMessage({ code: '23514' })).toMatch(/Kommentaren måste vara 1–280/)
    expect(commentErrorMessage({ code: '42501' })).toMatch(/kan inte kommentera/)
    expect(commentErrorMessage({ code: '23503' })).toMatch(/finns inte längre/)
  })
})
