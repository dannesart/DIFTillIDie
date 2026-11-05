import type { SupabaseClient } from '@supabase/supabase-js'
import { computed, ref } from 'vue'
import type { ProfileRow, SupporterProfile } from '#shared/utils/profile'
import { HANDLE_PATTERN, PROFILE_COLUMNS, PROFILE_COLUMNS_BEFORE_DESIGN, toProfile } from '#shared/utils/profile'
import type { CommunityPost, PostRow } from './posts'
import { COLUMNS, COLUMNS_BEFORE_DESIGN, toCommunityPost } from './posts'

/*
 * One supporter's place on the stands (/laktaren/<handle>): their public
 * profile and their wall, i.e. their own Snacket posts, newest first, a page
 * at a time.
 *
 * The address is only that: an address. It's resolved to the supporter's
 * user id first, and everything after (their posts, their count, whether
 * it's your own page) uses the id. It can be
 *  - their handle (canonical),
 *  - one of their former handles (an alias, kept by the database), or
 *  - their user id (older links).
 * The last two resolve to the same supporter, and `canonical` says which
 * address to show instead.
 *
 * Who is shown is decided by the database, not here: a profile, and its
 * aliases, are readable by everyone once its supporter has posted or
 * commented, and always by themselves. Anything else (no such supporter, or
 * not public yet) comes back as the same 'hidden', so the page can't be used
 * to probe for accounts.
 */

export const WALL_PAGE = 20

export type WallStatus = 'idle' | 'loading' | 'ready' | 'hidden' | 'error'

interface DataError { code?: string, message?: string }
const missingColumn = (e: unknown) => (e as DataError | null)?.code === '42703'

/** A user id as Supabase issues them. */
export const isUserId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** What an address can be. Anything else is never sent to the database. Handles never look like ids. */
export function parseAddress(address: string): { id: string } | { handle: string } | null {
  if (isUserId(address)) return { id: address.toLowerCase() }
  const handle = address.replace(/^@/, '').toLowerCase()
  return HANDLE_PATTERN.test(handle) ? { handle } : null
}

export function createWall(client: SupabaseClient | null, address: string, options: { pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? WALL_PAGE
  const status = ref<WallStatus>('idle')
  const profile = ref<SupporterProfile | null>(null)
  const posts = ref<CommunityPost[]>([])
  /** How many posts they have published in all (from the database, not this page). */
  const total = ref<number | null>(null)
  const more = ref(false)
  const loadingMore = ref(false)
  const moreError = ref(false)
  /** The supporter's user id, once the address is resolved. */
  const id = computed(() => profile.value?.id ?? null)
  /** The address to show: their current handle (differs from `address` for an id or a former handle). */
  const canonical = computed(() => profile.value?.handle ?? null)
  /** Only the latest load() may write (e.g. the session restoring mid-load starts another). */
  let request = 0

  const profileBy = async (column: 'id' | 'handle', value: string) => {
    const one = (cols: string) => client!.from('profiles').select(cols).eq(column, value).maybeSingle()
    let { data, error: e } = await one(PROFILE_COLUMNS)
    if (missingColumn(e)) ({ data, error: e } = await one(PROFILE_COLUMNS_BEFORE_DESIGN))
    if (e) throw e
    return data ? toProfile(data as unknown as ProfileRow) : null
  }

  /** A former handle → that supporter's id (null when unknown, or not public). */
  async function aliasOf(handle: string) {
    const { data, error: e } = await client!.from('profile_handle_aliases').select('profile_id').eq('handle', handle).maybeSingle()
    // A database without aliases yet (42P01: no such table) simply has none.
    if (e && (e as DataError).code !== '42P01' && (e as DataError).code !== 'PGRST205') throw e
    return (data as { profile_id: string } | null)?.profile_id ?? null
  }

  async function resolve(): Promise<SupporterProfile | null> {
    const a = parseAddress(address)
    if (!a) return null
    if ('id' in a) return profileBy('id', a.id)
    const current = await profileBy('handle', a.handle)
    if (current) return current
    const aliased = await aliasOf(a.handle)
    return aliased ? profileBy('id', aliased) : null
  }

  /** One page of posts, older than `after` (keyset: created_at, then id). */
  async function page(authorId: string, after?: CommunityPost) {
    const query = (cols: string) => {
      let q = client!.from('posts').select(cols).eq('author_id', authorId)
      // Quoted: timestamps contain dots, colons and '+'.
      if (after) q = q.or(`created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})`)
      return q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1)
    }
    let { data, error: e } = await query(COLUMNS)
    if (missingColumn(e)) ({ data, error: e } = await query(COLUMNS_BEFORE_DESIGN))
    if (e) throw e
    const rows = (data ?? []) as unknown as PostRow[]
    return {
      list: rows.slice(0, pageSize).map(toCommunityPost).filter((p): p is CommunityPost => !!p),
      more: rows.length > pageSize,
    }
  }

  async function count(authorId: string) {
    const { count: n, error: e } = await client!.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', authorId)
    if (e) throw e
    return n
  }

  async function load() {
    if (!client) {
      status.value = 'error'
      return
    }
    if (!parseAddress(address)) {
      status.value = 'hidden'
      return
    }
    const mine = ++request
    status.value = 'loading'
    try {
      const found = await resolve()
      if (mine !== request) return
      if (!found) {
        profile.value = null
        status.value = 'hidden'
        return
      }
      const [first, n] = await Promise.all([page(found.id), count(found.id)])
      if (mine !== request) return
      profile.value = found
      posts.value = first.list
      more.value = first.more
      total.value = n
      status.value = 'ready'
    }
    catch {
      if (mine === request) status.value = 'error'
    }
  }

  async function loadMore() {
    if (!client || !id.value || !more.value || loadingMore.value || status.value !== 'ready') return
    loadingMore.value = true
    moreError.value = false
    try {
      const next = await page(id.value, posts.value.at(-1))
      const seen = new Set(posts.value.map(p => p.id))
      posts.value = [...posts.value, ...next.list.filter(p => !seen.has(p.id))]
      more.value = next.more
    }
    catch {
      moreError.value = true
    }
    finally {
      loadingMore.value = false
    }
  }

  /** A post of theirs was deleted elsewhere on the page (e.g. the owner deleting one here). */
  function forget(postId: string) {
    const before = posts.value.length
    posts.value = posts.value.filter(p => p.id !== postId)
    if (posts.value.length < before && total.value) total.value--
  }

  /** The owner edited their profile: show it at once (by id, never by handle). */
  function showProfile(p: SupporterProfile) {
    if (p.id !== id.value) return
    profile.value = p
    posts.value = posts.value.map(post => ({ ...post, author: { id: p.id, name: p.displayName, handle: p.handle, avatar: p.avatar } }))
  }

  return { address, id, canonical, status, profile, posts, total, more, loadingMore, moreError, load, loadMore, forget, showProfile }
}

export type WallStore = ReturnType<typeof createWall>
