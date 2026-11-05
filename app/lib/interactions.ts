import type { SupabaseClient } from '@supabase/supabase-js'
import { ref, watch } from 'vue'
import type { ReactionKey } from '#shared/types/domain'
import type { AuthorRow, PublicAuthor } from '#shared/utils/profile'
import { authorOf, toAuthor } from '#shared/utils/profile'
import type { AuthStore } from './auth'
import type { CommunityStore } from './posts'
import { normalizePostBody, publishErrorMessage, validatePostBody } from './posts'

/*
 * Real reactions and comments on real Snacket posts.
 *  - Totals come from post_stats(): counts only, never who reacted.
 *  - "Your" reaction comes from your own rows, which only you can read.
 *  - A reaction or comment counts once Supabase has confirmed it; until then
 *    the UI shows it as pending, and a failure changes nothing.
 */

export const REACTION_KEYS: ReactionKey[] = ['hjarta', 'eld', 'stjarna', 'tarar']

export interface PostStats { reactions: Record<ReactionKey, number>, comments: number }

export interface RealComment {
  id: string
  postId: string
  author: PublicAuthor
  body: string
  createdAt: string
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** At most this many comments are fetched per thread, oldest first. */
export const COMMENT_LIMIT = 200

/** `more`: the thread hit COMMENT_LIMIT, so older-first, later comments are not shown. */
interface CommentThread { status: LoadStatus, list: RealComment[], more: boolean }

const COMMENT_COLUMNS = 'id, post_id, body, created_at, author:profiles!post_comments_author_id_fkey(id, display_name, handle, avatar)'
/** A database without the supporter-profiles migration yet (42703: no avatar column): read what it has. */
export const COMMENT_COLUMNS_BEFORE_DESIGN = COMMENT_COLUMNS.replace(', avatar)', ')')
const missingColumn = (e: unknown) => (e as { code?: string } | null)?.code === '42703'

interface CommentRow {
  id: string
  post_id: string
  body: string
  created_at: string
  author: AuthorRow | AuthorRow[] | null
}

interface StatsRow { post_id: string, hjarta: number, eld: number, stjarna: number, tarar: number, comments: number }

export function toRealComment(r: CommentRow): RealComment | null {
  const a = Array.isArray(r.author) ? r.author[0] : r.author
  if (!a) return null
  return { id: r.id, postId: r.post_id, author: toAuthor(a), body: r.body, createdAt: r.created_at }
}

const emptyStats = (): PostStats => ({ reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: 0 })

interface DataError { code?: string, message?: string, status?: number }
const offline = (e: DataError | undefined) => /fetch|network|load failed|timed? ?out/i.test(`${e?.message ?? ''}`)

export function reactErrorMessage(e: DataError | undefined): string {
  if (offline(e)) return 'Ingen kontakt med servern. Försök igen.'
  if (e?.code === 'PGRST301' || e?.code === 'PGRST303' || /jwt/i.test(`${e?.message ?? ''}`) || e?.status === 401) return 'Du har blivit utloggad. Logga in igen.'
  if (e?.code === '42501') return 'Ditt konto kan inte reagera just nu.'
  if (e?.code === '23503') return 'Inlägget finns inte längre.'
  return 'Det gick inte att reagera. Försök igen.'
}

export function commentErrorMessage(e: DataError | undefined): string {
  if (e?.code === '23503') return 'Inlägget finns inte längre. Din kommentar finns kvar här.'
  // Same wording as posts: the text is always kept.
  return publishErrorMessage(e).replace('Ditt inlägg finns kvar', 'Din kommentar finns kvar').replace('Inlägget måste', 'Kommentaren måste').replace('publicera', 'kommentera')
}

export function createInteractions(client: SupabaseClient | null, auth: AuthStore | null, community: CommunityStore | null) {
  const stats = ref<Record<string, PostStats>>({})
  const statsStatus = ref<LoadStatus>('idle')
  /** When post_stats() last delivered totals (your own taps don't count). */
  const statsLoadedAt = ref<number | null>(null)
  /** Your own reaction per post (signed in only). */
  const mine = ref<Record<string, ReactionKey | null>>({})
  /** Posts with a reaction change on its way to Supabase. */
  const pending = ref<Record<string, boolean>>({})
  const threads = ref<Record<string, CommentThread>>({})
  const sending = ref<Record<string, boolean>>({})

  const canInteract = () => !!client && !!auth && auth.status.value === 'signed-in' && auth.profileStatus.value === 'ready'

  async function loadStats(ids: string[]) {
    if (!client || !ids.length) return
    if (statsStatus.value !== 'ready') statsStatus.value = 'loading'
    try {
      const { data, error: e } = await client.rpc('post_stats', { p_post_ids: ids })
      if (e) throw e
      const next = { ...stats.value }
      for (const id of ids) next[id] = emptyStats()
      for (const r of (data ?? []) as StatsRow[]) {
        next[r.post_id] = { reactions: { hjarta: r.hjarta, eld: r.eld, stjarna: r.stjarna, tarar: r.tarar }, comments: r.comments }
      }
      stats.value = next
      statsStatus.value = 'ready'
      statsLoadedAt.value = Date.now()
    }
    catch {
      // Keep any totals we had; without any, say so.
      if (statsStatus.value !== 'ready') statsStatus.value = 'error'
    }
  }

  async function loadMine(ids: string[]) {
    const uid = auth?.userId.value
    if (!client || !uid || !ids.length) return
    try {
      const { data, error: e } = await client.from('post_reactions').select('post_id, reaction').in('post_id', ids)
      if (e) throw e
      if (auth?.userId.value !== uid) return // someone else signed in meanwhile
      // Replace only these posts' entries: the feed and a supporter's wall load separately.
      const next: Record<string, ReactionKey | null> = { ...mine.value }
      for (const id of ids) delete next[id]
      for (const r of (data ?? []) as { post_id: string, reaction: ReactionKey }[]) next[r.post_id] = r.reaction
      mine.value = next
    }
    catch { /* your highlight stays as it was; totals are unaffected */ }
  }

  /** Tap a reaction: the same one again removes it, another replaces it. */
  async function react(postId: string, key: ReactionKey): Promise<{ ok: true } | { ok: false, message: string }> {
    if (!canInteract()) return { ok: false, message: 'Logga in och välj ditt läktarnamn för att reagera.' }
    if (pending.value[postId]) return { ok: false, message: 'Ett ögonblick…' }
    const wanted = mine.value[postId] === key ? null : key
    pending.value = { ...pending.value, [postId]: true }
    try {
      const { data, error: e } = await client!.rpc('set_post_reaction', { p_post_id: postId, p_reaction: wanted })
      if (e) throw e
      // The database says what it was before, so the totals move exactly.
      const previous = (data ?? null) as ReactionKey | null
      const s = stats.value[postId] ?? emptyStats()
      const reactions = { ...s.reactions }
      if (previous) reactions[previous] = Math.max(0, reactions[previous] - 1)
      if (wanted) reactions[wanted]++
      stats.value = { ...stats.value, [postId]: { ...s, reactions } }
      mine.value = { ...mine.value, [postId]: wanted }
      return { ok: true }
    }
    catch (e) {
      return { ok: false, message: reactErrorMessage(e as DataError) }
    }
    finally {
      const { [postId]: _, ...rest } = pending.value
      pending.value = rest
    }
  }

  async function loadComments(postId: string) {
    if (!client) return
    const prev = threads.value[postId]
    threads.value = { ...threads.value, [postId]: { status: prev?.list.length ? 'ready' : 'loading', list: prev?.list ?? [], more: prev?.more ?? false } }
    try {
      const list = (cols: string) => client.from('post_comments').select(cols)
        .eq('post_id', postId).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(COMMENT_LIMIT)
      let { data, error: e } = await list(COMMENT_COLUMNS)
      if (missingColumn(e)) ({ data, error: e } = await list(COMMENT_COLUMNS_BEFORE_DESIGN))
      if (e) throw e
      const rows = data as unknown as CommentRow[]
      const comments = rows.map(toRealComment).filter((c): c is RealComment => !!c)
      // The total stays post_stats()'s: this list is a capped page (and skips
      // rows without a visible author), so its length is not a count.
      threads.value = { ...threads.value, [postId]: { status: 'ready', list: comments, more: rows.length >= COMMENT_LIMIT } }
    }
    catch {
      threads.value = { ...threads.value, [postId]: { status: prev?.list.length ? 'ready' : 'error', list: prev?.list ?? [], more: prev?.more ?? false } }
    }
  }

  /** Comment as the signed-in supporter. Shown only once Supabase confirms it. */
  async function addComment(postId: string, input: string): Promise<{ ok: true } | { ok: false, message: string }> {
    if (!canInteract()) return { ok: false, message: 'Logga in och välj ditt läktarnamn för att kommentera.' }
    if (sending.value[postId]) return { ok: false, message: 'Skickar redan…' }
    const body = normalizePostBody(input)
    const invalid = validatePostBody(body)
    if (invalid) return { ok: false, message: invalid }
    sending.value = { ...sending.value, [postId]: true }
    try {
      // No author_id: the database sets it from the session and checks it.
      const insert = (cols: string) => client!.from('post_comments').insert({ post_id: postId, body }).select(cols).single()
      let { data, error: e } = await insert(COMMENT_COLUMNS)
      // A database without the avatar column yet. The insert and the columns it
      // returns are one SQL statement, so that error means nothing was saved:
      // asking again with the columns it has can't comment twice.
      if (missingColumn(e)) ({ data, error: e } = await insert(COMMENT_COLUMNS_BEFORE_DESIGN))
      if (e) throw e
      const c = toRealComment(data as unknown as CommentRow)
      if (!c) throw new Error('no author')
      const t = threads.value[postId] ?? { status: 'ready' as const, list: [], more: false }
      threads.value = { ...threads.value, [postId]: { status: 'ready', list: [...t.list.filter(x => x.id !== c.id), c], more: t.more } }
      const s = stats.value[postId] ?? emptyStats()
      stats.value = { ...stats.value, [postId]: { ...s, comments: s.comments + 1 } }
      return { ok: true }
    }
    catch (e) {
      return { ok: false, message: commentErrorMessage(e as DataError) }
    }
    finally {
      const { [postId]: _, ...rest } = sending.value
      sending.value = rest
    }
  }

  /** Delete your own comment. The database ignores anyone else's. */
  async function removeComment(postId: string, commentId: string): Promise<{ ok: true } | { ok: false, message: string }> {
    if (!client) return { ok: false, message: 'Inte påslaget här.' }
    try {
      const { data, error: e } = await client.from('post_comments').delete().eq('id', commentId).select('id')
      if (e) throw e
      if (!(data as unknown[] | null)?.length) return { ok: false, message: 'Kommentaren kunde inte tas bort.' }
      const t = threads.value[postId]
      if (t) threads.value = { ...threads.value, [postId]: { ...t, list: t.list.filter(c => c.id !== commentId) } }
      const s = stats.value[postId]
      if (s) stats.value = { ...stats.value, [postId]: { ...s, comments: Math.max(0, s.comments - 1) } }
      return { ok: true }
    }
    catch (e) {
      return { ok: false, message: offline(e as DataError) ? 'Ingen kontakt med servern. Försök igen.' : 'Kommentaren kunde inte tas bort. Försök igen.' }
    }
  }

  const ids = () => community?.posts.value.map(p => p.id) ?? []

  if (community) {
    // New or refreshed posts: fresh totals, your reactions, and any open threads.
    watch(community.posts, () => {
      const list = ids()
      void loadStats(list)
      void loadMine(list)
      for (const id of Object.keys(threads.value)) {
        if (list.includes(id)) void loadComments(id)
      }
    })
  }
  if (auth) {
    // Someone else (or nobody) now: your highlights belong to whoever is signed in.
    watch(auth.userId, () => {
      mine.value = {}
      void loadMine(ids())
    })
    // Your own comments follow a profile edit at once.
    watch(auth.profile, (p) => {
      if (!p) return
      const next: Record<string, CommentThread> = {}
      for (const [id, t] of Object.entries(threads.value)) {
        next[id] = { ...t, list: t.list.map(c => c.author.id === p.id ? { ...c, author: authorOf(p) } : c) }
      }
      threads.value = next
    })
  }

  return { stats, statsStatus, statsLoadedAt, mine, pending, threads, sending, loadStats, loadMine, react, loadComments, addComment, removeComment }
}

export type InteractionsStore = ReturnType<typeof createInteractions>
