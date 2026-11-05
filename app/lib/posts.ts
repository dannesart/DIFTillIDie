import type { SupabaseClient } from '@supabase/supabase-js'
import { ref, watch } from 'vue'
import type { FrozenStory, Sport, Story } from '#shared/types/domain'
import type { AuthStore } from './auth'

/*
 * Real Snacket posts, read from and published to Supabase through its Data
 * API. The database decides who may publish and stamps the author; this store
 * only shows what Supabase has confirmed. Nothing is ever shown as published
 * before the insert comes back.
 */

export const POST_MAX = 280

export interface CommunityPost {
  id: string
  author: { id: string, name: string, handle: string }
  body: string
  sport?: Sport
  storyId?: string
  /** The Story frozen when it was published. Absent for posts from before 2026-11-05. */
  storyRef?: FrozenStory
  createdAt: string
}

export type FeedStatus = 'unavailable' | 'idle' | 'loading' | 'ready' | 'error'

/** What the app reads for a post; also what publish_post() returns, with the author embedded. */
export const COLUMNS = 'id, body, sport, story_id, story_ref, created_at, author:profiles!posts_author_id_fkey(id, display_name, handle)'
/** A database without the frozen-Story migration yet (42703: no such column): read what it has. */
const COLUMNS_BEFORE_REFS = COLUMNS.replace(' story_ref,', '')

interface PostRow {
  id: string
  body: string
  sport: string | null
  story_id: string | null
  story_ref?: unknown
  created_at: string
  author: { id: string, display_name: string, handle: string } | { id: string, display_name: string, handle: string }[] | null
}

export function toCommunityPost(r: PostRow): CommunityPost | null {
  const a = Array.isArray(r.author) ? r.author[0] : r.author
  // Without a visible author there's nothing honest to show.
  if (!a) return null
  return {
    id: r.id,
    author: { id: a.id, name: a.display_name, handle: a.handle },
    body: r.body,
    sport: r.sport === 'fotboll' || r.sport === 'hockey' ? r.sport : undefined,
    storyId: r.story_id ?? undefined,
    storyRef: toFrozenStory(r.story_ref),
    createdAt: r.created_at,
  }
}

/** The database verified it on the way in; this only makes sure it can be shown. */
export function toFrozenStory(v: unknown): FrozenStory | undefined {
  const f = v as FrozenStory | null | undefined
  if (!f || typeof f !== 'object' || !Array.isArray(f.sources) || !f.sources.length) return undefined
  const ok = f.sources.every(s => s && typeof s.headline === 'string' && typeof s.url === 'string' && typeof s.outlet === 'string')
  return ok ? f : undefined
}

/** The source a frozen Story showed as its headline. */
export const frozenLead = (f: FrozenStory) => f.sources.find(s => s.key === f.leadKey) ?? f.sources[0]!

/** Length as the database counts it (characters, not UTF-16 units). */
export const postLength = (s: string) => [...s].length

/** Same cleanup the database insists on: no stray control characters, trimmed. */
export function normalizePostBody(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
}

export function validatePostBody(body: string): string | null {
  if (!body) return 'Skriv något först.'
  if (postLength(body) > POST_MAX) return `Max ${POST_MAX} tecken.`
  return null
}

interface DataError { code?: string, message?: string, status?: number }

const KEPT = 'Ditt inlägg finns kvar – försök igen.'
/** The Story couldn't be confirmed as one our server read from the feeds. */
export const STORY_UNVERIFIED = 'Storyn gick inte att bifoga just nu. Ta bort den och publicera, eller försök igen om en stund – ditt inlägg finns kvar.'

export function publishErrorMessage(e: DataError | undefined): string {
  const raw = `${e?.code ?? ''} ${e?.message ?? ''}`
  if (/fetch|network|load failed|timed? ?out/i.test(raw)) return `Ingen kontakt med servern. ${KEPT}`
  if (e?.code === 'PGRST301' || e?.code === 'PGRST303' || /jwt/i.test(raw) || e?.status === 401) return 'Du har blivit utloggad. Logga in igen – ditt inlägg finns kvar.'
  if (e?.code === '42501' || e?.code === '23503') return 'Ditt konto kan inte publicera just nu. Ditt inlägg finns kvar.'
  if (e?.code === '22023' && /story/i.test(raw)) return STORY_UNVERIFIED
  if (e?.code === '23514') return `Inlägget måste vara 1–${POST_MAX} tecken, utan konstiga tecken.`
  return `Det gick inte att publicera. ${KEPT}`
}

export type PublishResult = { ok: true, post: CommunityPost } | { ok: false, message: string }

export function createCommunity(client: SupabaseClient | null, auth: AuthStore | null, options: { limit?: number, initialStatus?: FeedStatus, now?: () => number } = {}) {
  const limit = options.limit ?? 50
  const now = options.now ?? Date.now
  const status = ref<FeedStatus>(options.initialStatus ?? (client ? 'idle' : 'unavailable'))
  const posts = ref<CommunityPost[]>([])
  /** A refresh failed while older posts are still shown. */
  const stale = ref(false)
  const refreshing = ref(false)
  const publishing = ref(false)
  const loadedAt = ref<number | null>(null)
  let inflight: Promise<void> | null = null

  function refresh(): Promise<void> {
    if (!client) return Promise.resolve()
    if (inflight) return inflight
    if (!posts.value.length) status.value = 'loading'
    refreshing.value = true
    inflight = (async () => {
      try {
        const list = (cols: string) => client.from('posts').select(cols).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
        let { data, error: e } = await list(COLUMNS)
        if ((e as DataError | null)?.code === '42703') ({ data, error: e } = await list(COLUMNS_BEFORE_REFS))
        if (e) throw e
        posts.value = (data as unknown as PostRow[]).map(toCommunityPost).filter((p): p is CommunityPost => !!p)
        status.value = 'ready'
        stale.value = false
        loadedAt.value = now()
      }
      catch {
        if (posts.value.length) stale.value = true
        else status.value = 'error'
      }
      finally {
        refreshing.value = false
        inflight = null
      }
    })()
    return inflight
  }

  /** Publish as the signed-in supporter. Only Supabase's answer counts as published. */
  /**
   * `story`: the Story to attach. It goes along as our server's signed
   * capture, and the database freezes it into the post in the same
   * transaction: both, or neither. A Story without a capture can't be
   * attached, and the post isn't published without it behind your back.
   */
  async function publish(input: { body: string, sport?: Sport, story?: Story }): Promise<PublishResult> {
    if (!client || !auth) return { ok: false, message: 'Publicering är inte påslagen här.' }
    if (auth.status.value !== 'signed-in') return { ok: false, message: 'Logga in för att publicera.' }
    if (auth.profileStatus.value !== 'ready') return { ok: false, message: 'Välj ditt läktarnamn innan du publicerar.' }
    if (publishing.value) return { ok: false, message: 'Publicerar redan…' }
    const body = normalizePostBody(input.body)
    const invalid = validatePostBody(body)
    if (invalid) return { ok: false, message: invalid }
    if (input.story && !input.story.capture) return { ok: false, message: STORY_UNVERIFIED }
    publishing.value = true
    try {
      // No author: the database takes it from the session.
      const args = { p_body: body, p_sport: input.sport ?? null, p_story: input.story?.capture?.data ?? null, p_story_sig: input.story?.capture?.sig ?? null }
      const { data, error: e } = await client.rpc('publish_post', args).select(COLUMNS).single()
      if (e) throw e
      const post = toCommunityPost(data as unknown as PostRow)
      if (!post) throw new Error('no author')
      posts.value = [post, ...posts.value.filter(p => p.id !== post.id)]
      if (status.value !== 'ready' && !stale.value) status.value = 'ready'
      return { ok: true, post }
    }
    catch (e) {
      return { ok: false, message: publishErrorMessage(e as DataError) }
    }
    finally {
      publishing.value = false
    }
  }

  /** Delete your own post. The database ignores anyone else's. */
  async function remove(id: string): Promise<{ ok: true } | { ok: false, message: string }> {
    if (!client) return { ok: false, message: 'Publicering är inte påslagen här.' }
    try {
      const { data, error: e } = await client.from('posts').delete().eq('id', id).select('id')
      if (e) throw e
      if (!(data as unknown[] | null)?.length) return { ok: false, message: 'Inlägget kunde inte tas bort.' }
      posts.value = posts.value.filter(p => p.id !== id)
      return { ok: true }
    }
    catch (e) {
      const raw = `${(e as DataError)?.message ?? ''}`
      return { ok: false, message: /fetch|network|load failed/i.test(raw) ? 'Ingen kontakt med servern. Försök igen.' : 'Inlägget kunde inte tas bort. Försök igen.' }
    }
  }

  // Your own posts show your current name right away after a profile edit.
  if (auth) {
    watch(auth.profile, (p) => {
      if (!p) return
      posts.value = posts.value.map(post => post.author.id === p.id ? { ...post, author: { id: p.id, name: p.displayName, handle: p.handle } } : post)
    })
  }

  return { status, posts, stale, refreshing, publishing, loadedAt, refresh, publish, remove }
}

export type CommunityStore = ReturnType<typeof createCommunity>
