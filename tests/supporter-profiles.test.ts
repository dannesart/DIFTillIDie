import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStore } from '../app/lib/auth'
import { createPreferences } from '../app/lib/preferences'
import { createWall, isUserId, parseAddress } from '../app/lib/wall'
import { AVATARS, BIO_MAX, cleanBio, TEAM_INTERESTS, toAuthor } from '../shared/utils/profile'

/* A supporter's page (profile + wall) and their private team interests, against a fake Data API. */

const LOTTA = '11111111-1111-4111-8111-111111111111'
const lotta = { id: LOTTA, display_name: 'Lotta från Gärdet', handle: 'lotta', bio: 'Sektion A.', avatar: 'halsduk' }
const post = (n: number) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, body: `Inlägg ${n}`, sport: null, story_id: null, story_ref: null, created_at: `2026-11-0${n}T12:00:00+00:00`, author: lotta })

type Result = { data?: unknown, error?: unknown, count?: number | null }

/* Records every call; `answer` decides what each finished query returns. */
function fakeClient(answer: (q: { table: string, cols: string, filters: unknown[][], head: boolean, rpc?: unknown }) => Result) {
  const calls: { table: string, cols: string, filters: unknown[][], head: boolean, rpc?: unknown }[] = []
  const query = (table: string) => {
    const q = { table, cols: '', filters: [] as unknown[][], head: false }
    const run = async () => {
      calls.push({ ...q, filters: [...q.filters] })
      const r = answer(q)
      return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }
    }
    const chain: Record<string, unknown> = {
      select(cols: string, o?: { head?: boolean }) { q.cols = cols; q.head = !!o?.head; return chain },
      eq(...a: unknown[]) { q.filters.push(['eq', ...a]); return chain },
      or(...a: unknown[]) { q.filters.push(['or', ...a]); return chain },
      order(...a: unknown[]) { q.filters.push(['order', ...a]); return chain },
      limit(...a: unknown[]) { q.filters.push(['limit', ...a]); return chain },
      // Like postgrest-js: zero or one row, as the row itself.
      maybeSingle: async () => { const r = await run(); return Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r },
      single: run,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
    }
    return chain
  }
  const client = {
    from: (t: string) => query(t),
    rpc: (fn: string, args: unknown) => ({
      single: async () => {
        const q = { table: `rpc:${fn}`, cols: '', filters: [], head: false, rpc: args }
        calls.push(q)
        const r = answer(q)
        return { data: r.data ?? null, error: r.error ?? null }
      },
    }),
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('a supporter’s page', () => {
  it('shows the public profile, the newest page of posts and the true total', async () => {
    const { client, calls } = fakeClient(q => q.table === 'profiles'
      ? { data: lotta }
      : q.head ? { count: 7 } : { data: [post(5), post(4), post(3)] })
    const wall = createWall(client, LOTTA, { pageSize: 2 })
    await wall.load()
    expect(wall.status.value).toBe('ready')
    expect(wall.profile.value).toEqual({ id: LOTTA, displayName: 'Lotta från Gärdet', handle: 'lotta', bio: 'Sektion A.', avatar: 'halsduk' })
    expect(wall.posts.value.map(p => p.body)).toEqual(['Inlägg 5', 'Inlägg 4'])
    expect([wall.more.value, wall.total.value]).toEqual([true, 7])
    // Only this supporter's posts, newest first; only public columns.
    const list = calls.find(c => c.table === 'posts' && !c.head)!
    expect(list.filters).toContainEqual(['eq', 'author_id', LOTTA])
    expect(list.filters).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(calls.find(c => c.table === 'profiles')!.cols).toBe('id, display_name, handle, bio, avatar')
  })

  it('pages on with a keyset after the last post shown, without repeats', async () => {
    let page = 0
    const { client, calls } = fakeClient(q => q.table === 'profiles' ? { data: lotta } : q.head ? { count: 3 } : page++ === 0 ? { data: [post(5), post(4), post(3)] } : { data: [post(4), post(3)] })
    const wall = createWall(client, LOTTA, { pageSize: 2 })
    await wall.load()
    await wall.loadMore()
    expect(wall.posts.value.map(p => p.body)).toEqual(['Inlägg 5', 'Inlägg 4', 'Inlägg 3'])
    expect(wall.more.value).toBe(false)
    const second = calls.filter(c => c.table === 'posts' && !c.head).at(-1)!
    expect(second.filters).toContainEqual(['or', `created_at.lt."${post(4).created_at}",and(created_at.eq."${post(4).created_at}",id.lt.${post(4).id})`])
  })

  it('no such supporter and a supporter who isn’t public yet look the same: hidden', async () => {
    const { client, calls } = fakeClient(q => (q.table === 'profiles' ? { data: null } : { data: [] }))
    const wall = createWall(client, LOTTA)
    await wall.load()
    expect(wall.status.value).toBe('hidden')
    expect(calls.some(c => c.table === 'posts')).toBe(false)
  })

  it('an address that is neither a handle nor a user id never reaches the database', async () => {
    const { client, calls } = fakeClient(() => ({ data: null }))
    for (const bad of ['', 'xy', 'lotta-g', '1 or 1=1', 'a'.repeat(21), 'lotta/../admin', '11111111-1111-4111-8111']) {
      expect(parseAddress(bad), bad).toBeNull()
      const wall = createWall(client, bad)
      await wall.load()
      expect(wall.status.value).toBe('hidden')
    }
    expect(calls).toEqual([])
    expect(isUserId(LOTTA)).toBe(true)
  })
})

describe('addresses: handle first, user id underneath', () => {
  const byHandle = (q: { filters: unknown[][] }) => q.filters.find(f => f[0] === 'eq' && f[1] === 'handle')?.[2]
  const byId = (q: { filters: unknown[][] }) => q.filters.find(f => f[0] === 'eq' && f[1] === 'id')?.[2]
  /* Lotta is "lotta" now and used to be "kaminen81". */
  const db = (q: { table: string, head: boolean, filters: unknown[][] }): Result => {
    if (q.table === 'profiles') return { data: byHandle(q) === 'lotta' || byId(q) === LOTTA ? [lotta] : [] }
    if (q.table === 'profile_handle_aliases') return { data: q.filters.some(f => f[2] === 'kaminen81') ? [{ profile_id: LOTTA }] : [] }
    return q.head ? { count: 1 } : { data: [post(1)] }
  }
  const first = (calls: { table: string, filters: unknown[][] }[], table: string) => calls.find(c => c.table === table)

  it('her handle: found by handle, and that is the address', async () => {
    const { client, calls } = fakeClient(db)
    const wall = createWall(client, 'lotta')
    await wall.load()
    expect([wall.status.value, wall.id.value, wall.canonical.value]).toEqual(['ready', LOTTA, 'lotta'])
    expect(first(calls, 'profiles')!.filters).toContainEqual(['eq', 'handle', 'lotta'])
    // Her posts are found by her id, never by the handle.
    expect(first(calls, 'posts')!.filters).toContainEqual(['eq', 'author_id', LOTTA])
    expect(calls.some(c => c.table === 'profile_handle_aliases')).toBe(false)
  })

  it('typed with capitals or an @: the same supporter, shown at her handle', async () => {
    const { client } = fakeClient(db)
    for (const typed of ['Lotta', '@lotta']) {
      const wall = createWall(client, typed)
      await wall.load()
      expect([wall.id.value, wall.canonical.value]).toEqual([LOTTA, 'lotta'])
    }
  })

  it('a former handle resolves through its alias to her, and her current handle', async () => {
    const { client, calls } = fakeClient(db)
    const wall = createWall(client, 'kaminen81')
    await wall.load()
    expect([wall.status.value, wall.id.value, wall.canonical.value]).toEqual(['ready', LOTTA, 'lotta'])
    expect(calls.filter(c => c.table === 'profiles').map(c => c.filters[0])).toEqual([['eq', 'handle', 'kaminen81'], ['eq', 'id', LOTTA]])
  })

  it('an old /laktaren/<user id> link: found by id, shown at her handle', async () => {
    const { client, calls } = fakeClient(db)
    const wall = createWall(client, LOTTA.toUpperCase())
    await wall.load()
    expect([wall.status.value, wall.canonical.value]).toEqual(['ready', 'lotta'])
    expect(first(calls, 'profiles')!.filters).toContainEqual(['eq', 'id', LOTTA])
  })

  it('an unknown handle, or one that isn’t public (the database shows neither): hidden', async () => {
    const { client } = fakeClient(db)
    const wall = createWall(client, 'nobody_here')
    await wall.load()
    expect([wall.status.value, wall.id.value, wall.canonical.value]).toEqual(['hidden', null, null])
  })

  it('a database without aliases yet: no alias, not an error', async () => {
    const { client } = fakeClient(q => (q.table === 'profile_handle_aliases' ? { error: { code: '42P01', message: 'relation does not exist' } } : db(q)))
    const wall = createWall(client, 'kaminen81')
    await wall.load()
    expect(wall.status.value).toBe('hidden')
  })

  it('a network failure says so, and can be retried', async () => {
    let fail = true
    const { client } = fakeClient(q => (fail ? { error: { message: 'Failed to fetch' } } : q.table === 'profiles' ? { data: lotta } : q.head ? { count: 0 } : { data: [] }))
    const wall = createWall(client, LOTTA)
    await wall.load()
    expect(wall.status.value).toBe('error')
    fail = false
    await wall.load()
    expect([wall.status.value, wall.total.value]).toEqual(['ready', 0])
  })

  it('reads a database without bio and avatar yet', async () => {
    const { client } = fakeClient(q => q.table === 'profiles'
      ? (q.cols.includes('bio') ? { error: { code: '42703' } } : { data: { id: LOTTA, display_name: 'Lotta', handle: 'lotta' } })
      : q.head ? { count: 0 } : q.cols.includes('avatar') ? { error: { code: '42703' } } : { data: [] })
    const wall = createWall(client, LOTTA)
    await wall.load()
    expect([wall.status.value, wall.profile.value?.bio, wall.profile.value?.avatar]).toEqual(['ready', null, null])
  })

  it('a deleted post leaves the wall and the count', async () => {
    const { client } = fakeClient(q => (q.table === 'profiles' ? { data: lotta } : q.head ? { count: 2 } : { data: [post(2), post(1)] }))
    const wall = createWall(client, LOTTA)
    await wall.load()
    wall.forget(post(2).id)
    expect([wall.posts.value.length, wall.total.value]).toEqual([1, 1])
  })
})

describe('team interests (only yours)', () => {
  const fakeAuth = (id: string | null) => ({ userId: ref(id) }) as unknown as AuthStore

  it('loads yours and saves a change only when Supabase confirms it', async () => {
    let saved: string[] = ['hockey:dam']
    const { client, calls } = fakeClient((q) => {
      if (q.table === 'profile_preferences') return { data: { teams: saved } }
      saved = (q.rpc as { p_teams: string[] }).p_teams
      return { data: { teams: [...saved].sort() } }
    })
    const auth = fakeAuth(LOTTA)
    const prefs = createPreferences(client, auth)
    await prefs.load()
    expect(prefs.teams.value).toEqual(['hockey:dam'])
    expect(calls[0]!.filters).toContainEqual(['eq', 'profile_id', LOTTA])
    expect(await prefs.toggle('fotboll:herr')).toBe(true)
    expect(prefs.teams.value).toEqual(['fotboll:herr', 'hockey:dam'])
    expect(calls.at(-1)!.rpc).toEqual({ p_teams: ['fotboll:herr', 'hockey:dam'] })
    await prefs.toggle('hockey:dam')
    expect(prefs.teams.value).toEqual(['fotboll:herr'])
  })

  it('a failed save changes nothing and says so', async () => {
    const { client } = fakeClient(q => (q.table === 'profile_preferences' ? { data: null } : { error: { message: 'Failed to fetch' } }))
    const prefs = createPreferences(client, fakeAuth(LOTTA))
    await prefs.load()
    expect(prefs.teams.value).toEqual([])
    expect(await prefs.toggle('fotboll:dam')).toBe(false)
    expect([prefs.teams.value, prefs.error.value]).toEqual([[], 'Det gick inte att spara. Försök igen.'])
  })

  it('belong to whoever is signed in: forgotten when that changes', async () => {
    const { client } = fakeClient(() => ({ data: { teams: ['fotboll:herr'] } }))
    const auth = fakeAuth(LOTTA)
    const prefs = createPreferences(client, auth)
    await prefs.load()
    auth.userId.value = null
    await nextTick()
    expect([prefs.teams.value, prefs.status.value]).toEqual([[], 'idle'])
  })

  it('a database without the table yet: unavailable, not "try again"', async () => {
    const { client } = fakeClient(() => ({ error: { code: 'PGRST205', message: 'Could not find the table public.profile_preferences in the schema cache' } }))
    const prefs = createPreferences(client, fakeAuth(LOTTA))
    await prefs.load()
    expect(prefs.status.value).toBe('unavailable')
    expect(await prefs.toggle('fotboll:herr')).toBe(false)
  })

  it('signed out: nothing is asked for', async () => {
    const { client, calls } = fakeClient(() => ({ data: null }))
    await createPreferences(client, fakeAuth(null)).load()
    expect(calls).toEqual([])
  })
})

describe('profile rules match the database', () => {
  const sql = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261105230000_supporter_profiles.sql', import.meta.url)), 'utf8')
  const quoted = (s: string) => s.match(/'([^']+)'/g)!.map(x => x.slice(1, -1))

  it('the avatar designs', () => {
    expect(quoted(sql.match(/avatar in \(([^)]*)\)/)![1]!)).toEqual(AVATARS.map(a => a.key))
  })

  it('the four teams', () => {
    expect(quoted(sql.match(/teams <@ array\[([^\]]*)\]/)![1]!)).toEqual(TEAM_INTERESTS.map(t => t.key))
  })

  it('a bio: optional, one paragraph, at most 160 characters', () => {
    expect(BIO_MAX).toBe(Number(sql.match(/char_length\(bio\) between 1 and (\d+)/)![1]))
    expect(cleanBio('   ')).toEqual({ ok: true, bio: null })
    expect(cleanBio('  Sektion A\n\n sedan -98. ')).toEqual({ ok: true, bio: 'Sektion A sedan -98.' })
    expect(cleanBio('💙'.repeat(160))).toEqual({ ok: true, bio: '💙'.repeat(160) })
    expect(cleanBio('x'.repeat(161))).toEqual({ ok: false, error: 'Högst 160 tecken.' })
  })

  it('an unknown avatar from the database is shown as the default', () => {
    expect(toAuthor({ id: LOTTA, display_name: 'Lotta', handle: 'lotta', avatar: 'något-nytt' }).avatar).toBeNull()
    expect(toAuthor({ id: LOTTA, display_name: 'Lotta', handle: 'lotta' }).avatar).toBeNull()
  })
})
