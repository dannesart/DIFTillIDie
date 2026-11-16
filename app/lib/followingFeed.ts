import type { SupabaseClient } from '@supabase/supabase-js'
import { ref, watch } from 'vue'
import type { Sport } from '#shared/types/domain'
import type { AuthStore } from './auth'
import { followsMissing } from './follows'
import type { CommunityPost, PostRow } from './posts'
import { COLUMNS, COLUMNS_BEFORE_DESIGN, toCommunityPost } from './posts'

/*
 * Följer in Snacket på stan (#9): posts by the supporters you follow, newest
 * first, a page at a time. Asked of the database, never filtered out of the
 * newest 50 that Hetast and Nyast show, so it's complete however quiet the
 * people you follow are.
 *
 * Two reads, both as you, under the existing rules (no new database access):
 *  1. whom you follow: your own supporter_follows rows, the only ones you can
 *     read (newest follows first, at most FOLLOWING_CAP);
 *  2. their posts: posts are readable by everyone, so this is the same read
 *     as Snacket's, narrowed to those authors (and the sport), with the same
 *     keyset paging as a läktarplats (created_at, then id).
 *
 * Nobody else's follows are ever read. Your own posts aren't in it: you can't
 * follow yourself.
 */

export const FOLLOWING_PAGE = 20
/**
 * The most recent follows the feed covers. Their ids travel in the request's
 * address, so it is bounded; past this the page says so (`capped`), rather
 * than quietly leaving people out.
 */
export const FOLLOWING_CAP = 150

/** 'unavailable': a database without following. */
export type FollowingFeedStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'

interface DataError { code?: string }
const missingColumn = (e: unknown) => (e as DataError | null)?.code === '42703'

/** Sport (posts without one belong to both, as in Snacket) and the keyset, as one PostgREST filter. */
export function followingFilter(sport?: Sport, after?: Pick<CommunityPost, 'createdAt' | 'id'>): string | null {
  const parts: string[] = []
  if (sport) parts.push(`sport.is.null,sport.eq.${sport}`)
  // Quoted: timestamps contain dots, colons and '+'.
  if (after) parts.push(`created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})`)
  if (parts.length < 2) return parts[0] ?? null
  return `and(${parts.map(p => `or(${p})`).join(',')})`
}

export function createFollowingFeed(client: SupabaseClient | null, auth: AuthStore | null, options: { pageSize?: number, cap?: number } = {}) {
  const pageSize = options.pageSize ?? FOLLOWING_PAGE
  const cap = options.cap ?? FOLLOWING_CAP
  const status = ref<FollowingFeedStatus>('idle')
  const posts = ref<CommunityPost[]>([])
  /** How many supporters the feed covers (0: you follow nobody). */
  const followed = ref(0)
  /** You follow more than FOLLOWING_CAP: only the most recent are covered. */
  const capped = ref(false)
  const more = ref(false)
  const loadingMore = ref(false)
  const moreError = ref(false)
  let authors: string[] = []
  let sport: Sport | undefined
  /** Only the latest load() may write. */
  let request = 0

  async function whom(): Promise<string[]> {
    const { data, error: e } = await client!.from('supporter_follows').select('followed_id').order('created_at', { ascending: false }).limit(cap + 1)
    if (e) throw e
    return ((data ?? []) as { followed_id: string }[]).map(r => r.followed_id)
  }

  async function page(after?: CommunityPost) {
    const query = (cols: string) => {
      let q = client!.from('posts').select(cols).in('author_id', authors)
      const f = followingFilter(sport, after)
      if (f) q = q.or(f)
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

  /** The first page, for `sportFilter` (undefined: both sports). Signed out there is nothing to ask. */
  async function load(sportFilter?: Sport) {
    const mine = ++request
    // Another sport: the posts shown are the wrong ones until the new ones are in.
    const switched = sportFilter !== sport
    sport = sportFilter
    moreError.value = false
    if (!client) return void (status.value = 'unavailable')
    if (!auth?.userId.value) {
      posts.value = []
      status.value = 'idle'
      return
    }
    if (status.value !== 'ready' || switched) status.value = 'loading'
    try {
      const ids = await whom()
      if (mine !== request) return
      capped.value = ids.length > cap
      authors = ids.slice(0, cap)
      followed.value = authors.length
      const first = authors.length ? await page() : { list: [], more: false }
      if (mine !== request) return
      posts.value = first.list
      more.value = first.more
      status.value = 'ready'
    }
    catch (e) {
      if (mine !== request) return
      status.value = followsMissing(e) ? 'unavailable' : 'error'
    }
  }

  async function loadMore() {
    if (!client || !more.value || loadingMore.value || status.value !== 'ready') return
    const mine = request
    loadingMore.value = true
    moreError.value = false
    try {
      const next = await page(posts.value.at(-1))
      if (mine !== request) return
      const seen = new Set(posts.value.map(p => p.id))
      posts.value = [...posts.value, ...next.list.filter(p => !seen.has(p.id))]
      more.value = next.more
    }
    catch {
      if (mine === request) moreError.value = true
    }
    finally {
      loadingMore.value = false
    }
  }

  /** You stopped following them: their posts leave at once. */
  function drop(authorId: string) {
    if (!authors.includes(authorId)) return
    authors = authors.filter(a => a !== authorId)
    followed.value = authors.length
    posts.value = posts.value.filter(p => p.author.id !== authorId)
    if (!authors.length) more.value = false
  }

  // Your follows are yours: forget them when whoever is signed in changes.
  if (auth) {
    watch(auth.userId, () => {
      request++
      authors = []
      posts.value = []
      followed.value = 0
      capped.value = false
      more.value = false
      if (status.value !== 'unavailable') status.value = 'idle'
    })
  }

  return { status, posts, followed, capped, more, loadingMore, moreError, load, loadMore, drop }
}

export type FollowingFeedStore = ReturnType<typeof createFollowingFeed>
