import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { AuthStore } from '../app/lib/auth'
import { createFeedSort } from '../app/lib/feedSort'
import { createFollowingFeed, followingFilter } from '../app/lib/followingFeed'

/*
 * Följer in Snacket (#9): posts by the supporters you follow, newest first,
 * page by page. Run through the real supabase-js client against a small
 * in-memory PostgREST (the filters this feature sends: in, or/and, lt, eq,
 * is.null, order, limit), so the exact query it builds is what's tested,
 * with the database's rule that you read only your own follows.
 */

const ME = '00000000-0000-4000-8000-000000000001'
const LOTTA = '00000000-0000-4000-8000-00000000000a'
const KALLE = '00000000-0000-4000-8000-00000000000b'
const OLLE = '00000000-0000-4000-8000-00000000000c'
const STINA = '00000000-0000-4000-8000-00000000000d'

const people: Record<string, { id: string, display_name: string, handle: string, avatar: string | null }> = {
  [ME]: { id: ME, display_name: 'Mattias', handle: 'mattias', avatar: null },
  [LOTTA]: { id: LOTTA, display_name: 'Lotta från Gärdet', handle: 'lotta', avatar: 'halsduk' },
  [KALLE]: { id: KALLE, display_name: 'Kalle', handle: 'kalle', avatar: null },
  [OLLE]: { id: OLLE, display_name: 'Olle', handle: 'olle', avatar: null },
  [STINA]: { id: STINA, display_name: 'Stina', handle: 'stina', avatar: null },
}

interface Post { id: string, author_id: string, body: string, sport: string | null, story_id: null, story_ref: null, created_at: string }
interface Follow { follower_id: string, followed_id: string, created_at: string }

const at = (minute: number) => new Date(Date.UTC(2026, 10, 16, 12, 0, 0) + minute * 60_000).toISOString().replace('Z', '+00:00')
const postId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/* ── A small PostgREST, enough for this feature's reads ── */

function split(s: string): string[] {
  const out: string[] = []
  let depth = 0, quoted = false, cur = ''
  for (const ch of s) {
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === '(') depth++
    if (!quoted && ch === ')') depth--
    if (!quoted && depth === 0 && ch === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}
/** Byte order, as Postgres compares these timestamps and uuids (never locale order). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)
type Row = Record<string, unknown>
function test(row: Row, expr: string): boolean {
  const logic = /^(and|or)\((.*)\)$/.exec(expr)
  if (logic) {
    const parts = split(logic[2]!).map(p => test(row, p))
    return logic[1] === 'and' ? parts.every(Boolean) : parts.some(Boolean)
  }
  const [col, op, ...rest] = expr.split('.')
  const value = unquote(rest.join('.'))
  const v = row[col!] as string | null
  switch (op) {
    case 'eq': return v === value
    case 'lt': return v !== null && v < value
    case 'is': return value === 'null' ? v === null : false
    case 'in': return split(value.replace(/^\(|\)$/g, '')).map(unquote).includes(v as string)
    default: throw new Error(`unsupported operator ${op} in ${expr}`)
  }
}

function fakeDatabase(opts: { follows: Follow[], posts: Post[], me: () => string | null, fail?: (table: string) => unknown }) {
  const requests: { table: string, params: [string, string][] }[] = []
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input))
    const table = url.pathname.replace('/rest/v1/', '')
    const params = [...url.searchParams.entries()]
    requests.push({ table, params })
    const failure = opts.fail?.(table)
    if (failure) return new Response(JSON.stringify(failure), { status: 400, headers: { 'content-type': 'application/json' } })
    let rows: Row[]
    if (table === 'supporter_follows') {
      // Row level security: your own follows, nobody else's (and nothing signed out).
      rows = opts.follows.filter(f => f.follower_id === opts.me())
    }
    else if (table === 'posts') {
      rows = opts.posts.map(p => ({ ...p, author: people[p.author_id] }))
    }
    else throw new Error(`unexpected read of ${table}`)
    for (const [key, value] of params) {
      if (['select', 'order', 'limit'].includes(key)) continue
      rows = rows.filter(r => test(r, key === 'or' || key === 'and' ? `${key}${value}` : `${key}.${value}`))
    }
    const order = url.searchParams.get('order')
    if (order) {
      const keys = order.split(',').map(o => o.split('.') as [string, string])
      rows.sort((a, b) => {
        for (const [col, dir] of keys) {
          const c = cmp(String(a[col]), String(b[col]))
          if (c) return dir === 'desc' ? -c : c
        }
        return 0
      })
    }
    const limit = Number(url.searchParams.get('limit') ?? Infinity)
    return new Response(JSON.stringify(rows.slice(0, limit)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const client = createClient('https://fake.supabase.co', 'publishable-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } })
  return { client, requests }
}

const authAs = (id: string | null) => ({ userId: ref(id) }) as unknown as AuthStore

/* ── Real-shaped data: I follow Lotta and Kalle; Olle and I post too; Stina follows me ── */

function world() {
  const follows: Follow[] = [
    { follower_id: ME, followed_id: LOTTA, created_at: at(-500) },
    { follower_id: ME, followed_id: KALLE, created_at: at(-400) },
    // Someone else's follows: never read, never shown
    { follower_id: STINA, followed_id: OLLE, created_at: at(-300) },
    { follower_id: STINA, followed_id: ME, created_at: at(-300) },
  ]
  const posts: Post[] = []
  let n = 0
  const add = (author: string, minute: number, sport: string | null) => posts.push({ id: postId(++n), author_id: author, body: `Inlägg ${n} av ${people[author]!.handle}`, sport, story_id: null, story_ref: null, created_at: at(minute) })
  // 45 posts by the two I follow, spread over sports, with some at the very same moment
  for (let i = 0; i < 45; i++) add(i % 3 === 0 ? KALLE : LOTTA, -i * 7 - (i % 5 === 0 ? 0 : 1), i % 4 === 0 ? 'hockey' : i % 4 === 1 ? null : 'fotboll')
  add(LOTTA, -20, 'fotboll')
  add(KALLE, -20, 'hockey') // same created_at as the one above: the id breaks the tie
  // Unrelated: Olle (followed by Stina, not me) and my own posts, newer than everything
  for (let i = 0; i < 30; i++) add(OLLE, 10 + i, 'fotboll')
  for (let i = 0; i < 5; i++) add(ME, 50 + i, null)
  return { follows, posts }
}

/** What the feed must be: every post by the people I follow, newest first (created_at, then id). */
const expected = (posts: Post[], authors: string[], sport?: string) => posts
  .filter(p => authors.includes(p.author_id) && (!sport || p.sport === null || p.sport === sport))
  .sort((a, b) => cmp(b.created_at, a.created_at) || cmp(b.id, a.id))
  .map(p => p.id)

async function readAll(feed: ReturnType<typeof createFollowingFeed>) {
  let guard = 0
  while (feed.more.value && guard++ < 20) await feed.loadMore()
  return feed.posts.value.map(p => p.id)
}

describe('Följer: the posts of the supporters you follow', () => {
  it('only the people you follow: never unrelated authors, never your own posts', async () => {
    const w = world()
    const { client } = fakeDatabase({ ...w, me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME), { pageSize: 20 })
    await feed.load()
    expect(feed.status.value).toBe('ready')
    expect(feed.followed.value).toBe(2)
    const all = await readAll(feed)
    const authors = new Set(feed.posts.value.map(p => p.author.id))
    expect([...authors].sort()).toEqual([LOTTA, KALLE].sort())
    expect(all).toHaveLength(47)
  })

  it('pages on past the first page, newest first, complete and without repeats (ties broken by id)', async () => {
    const w = world()
    const { client, requests } = fakeDatabase({ ...w, me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME), { pageSize: 20 })
    await feed.load()
    expect(feed.posts.value).toHaveLength(20)
    expect(feed.more.value).toBe(true)
    const all = await readAll(feed)
    expect(all).toEqual(expected(w.posts, [LOTTA, KALLE]))
    expect(new Set(all).size).toBe(all.length)
    expect(feed.more.value).toBe(false)
    // Three pages, each asked of the database after the last post shown
    const pages = requests.filter(r => r.table === 'posts')
    expect(pages).toHaveLength(3)
    expect(pages[1]!.params.find(([k]) => k === 'or')?.[1]).toContain('created_at.lt.')
  })

  it('is not the newest 50 filtered: older posts by the people you follow are there, however busy Snacket is', async () => {
    const w = world()
    const { client } = fakeDatabase({ ...w, me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME), { pageSize: 20 })
    await feed.load()
    const all = await readAll(feed)
    const newest50 = [...w.posts].sort((a, b) => cmp(b.created_at, a.created_at)).slice(0, 50).map(p => p.id)
    expect(all.filter(id => !newest50.includes(id)).length).toBeGreaterThan(0)
  })

  it('a sport: only its posts and those without a sport (as in Snacket), still paged completely', async () => {
    const w = world()
    const { client } = fakeDatabase({ ...w, me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME), { pageSize: 7 })
    await feed.load('hockey')
    const all = await readAll(feed)
    expect(all).toEqual(expected(w.posts, [LOTTA, KALLE], 'hockey'))
    expect(feed.posts.value.every(p => p.sport === 'hockey' || p.sport === undefined)).toBe(true)
    // Switching sport starts again from the top
    await feed.load('fotboll')
    expect(feed.posts.value.map(p => p.id)).toEqual(expected(w.posts, [LOTTA, KALLE], 'fotboll').slice(0, 7))
  })

  it('reads only your own follows (nobody else’s), and nothing but follows and posts', async () => {
    const w = world()
    const { client, requests } = fakeDatabase({ ...w, me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME))
    await feed.load()
    expect(new Set(requests.map(r => r.table))).toEqual(new Set(['supporter_follows', 'posts']))
    const authors = requests.find(r => r.table === 'posts')!.params.find(([k]) => k === 'author_id')![1]
    expect(authors).toContain(LOTTA)
    expect(authors).toContain(KALLE)
    expect(authors).not.toContain(OLLE)
    expect(authors).not.toContain(ME)
  })

  it('unfollowing: their posts leave at once, and stay gone on the next load', async () => {
    const w = world()
    const { client } = fakeDatabase({ ...w, me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME), { pageSize: 100 })
    await feed.load()
    feed.drop(KALLE)
    expect(feed.posts.value.every(p => p.author.id === LOTTA)).toBe(true)
    expect(feed.followed.value).toBe(1)
    w.follows.splice(w.follows.findIndex(f => f.follower_id === ME && f.followed_id === KALLE), 1)
    await feed.load()
    expect(feed.posts.value.map(p => p.id)).toEqual(expected(w.posts, [LOTTA]))
  })

  it('signed out: nothing is asked, nothing shown', async () => {
    const w = world()
    const { client, requests } = fakeDatabase({ ...w, me: () => null })
    const feed = createFollowingFeed(client, authAs(null))
    await feed.load()
    expect([feed.status.value, feed.posts.value.length, requests.length]).toEqual(['idle', 0, 0])
  })

  it('following nobody: an honest empty feed, and no posts are asked for', async () => {
    const w = world()
    const { client, requests } = fakeDatabase({ ...w, follows: w.follows.filter(f => f.follower_id !== ME), me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME))
    await feed.load()
    expect([feed.status.value, feed.followed.value, feed.posts.value.length]).toEqual(['ready', 0, 0])
    expect(requests.some(r => r.table === 'posts')).toBe(false)
  })

  it('following people who haven’t posted: empty, but not "you follow nobody"', async () => {
    const w = world()
    const { client } = fakeDatabase({ ...w, follows: [{ follower_id: ME, followed_id: STINA, created_at: at(0) }], me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME))
    await feed.load()
    expect([feed.status.value, feed.followed.value, feed.posts.value.length]).toEqual(['ready', 1, 0])
  })

  it('a failure says so and can be retried; a failed "Visa fler" keeps what’s shown', async () => {
    const w = world()
    let failing: string | null = 'posts'
    const { client } = fakeDatabase({ ...w, me: () => ME, fail: t => (t === failing ? { code: 'XX000', message: 'boom' } : null) })
    const feed = createFollowingFeed(client, authAs(ME), { pageSize: 20 })
    await feed.load()
    expect(feed.status.value).toBe('error')
    failing = null
    await feed.load()
    expect(feed.status.value).toBe('ready')
    failing = 'posts'
    await feed.loadMore()
    expect([feed.status.value, feed.moreError.value, feed.posts.value.length]).toEqual(['ready', true, 20])
  })

  it('a database without following: unavailable, not an error', async () => {
    const w = world()
    const { client } = fakeDatabase({ ...w, me: () => ME, fail: t => (t === 'supporter_follows' ? { code: 'PGRST205', message: 'no table' } : null) })
    const feed = createFollowingFeed(client, authAs(ME))
    await feed.load()
    expect(feed.status.value).toBe('unavailable')
  })

  it('past the cap: the most recent follows, and it says so', async () => {
    const w = world()
    w.follows.push({ follower_id: ME, followed_id: OLLE, created_at: at(-100) })
    const { client } = fakeDatabase({ ...w, me: () => ME })
    const feed = createFollowingFeed(client, authAs(ME), { cap: 2, pageSize: 100 })
    await feed.load()
    expect(feed.capped.value).toBe(true)
    expect(new Set(feed.posts.value.map(p => p.author.id))).toEqual(new Set([OLLE, KALLE]))
  })

  it('someone else signs in: the previous supporter’s feed is gone', async () => {
    const w = world()
    const auth = authAs(ME)
    const { client } = fakeDatabase({ ...w, me: () => auth.userId.value })
    const feed = createFollowingFeed(client, auth)
    await feed.load()
    expect(feed.posts.value.length).toBeGreaterThan(0)
    ;(auth.userId as unknown as { value: string }).value = STINA
    await nextTick()
    expect([feed.status.value, feed.posts.value.length, feed.followed.value]).toEqual(['idle', 0, 0])
  })
})

describe('the filter it sends', () => {
  const after = { createdAt: '2026-11-16T12:00:00.123+00:00', id: postId(9) }
  it('nothing, a sport, a keyset, or both', () => {
    expect(followingFilter()).toBeNull()
    expect(followingFilter('hockey')).toBe('sport.is.null,sport.eq.hockey')
    expect(followingFilter(undefined, after)).toBe(`created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})`)
    expect(followingFilter('fotboll', after)).toBe(`and(or(sport.is.null,sport.eq.fotboll),or(created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})))`)
  })
})

describe('Hetast and Nyast are unchanged; Följer keeps the database’s order', () => {
  it('Följer is newest first, never re-ranked', () => {
    const posts = ref([{ id: 'a', createdAt: at(2) }, { id: 'b', createdAt: at(1) }])
    const sort = ref<'hetast' | 'nyast' | 'foljer'>('foljer')
    const s = createFeedSort({ sort, posts, stats: ref({ b: { reactions: { hjarta: 99, eld: 0, stjarna: 0, tarar: 0 }, comments: 9 } }), statsStatus: ref('ready'), statsLoadedAt: ref(1) })
    expect(s.state.value).toBe('newest')
    expect(s.apply(posts.value).map(p => p.id)).toEqual(['a', 'b'])
    sort.value = 'hetast'
    expect(s.state.value).toBe('ranked')
    expect(s.apply(posts.value).map(p => p.id)).toEqual(['b', 'a'])
  })
})
