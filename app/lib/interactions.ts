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

/**
 * The name of the link to a post's comments (its own page), for screen readers: it shows only "💬 3" on
 * phones. Says what it does and the count, like the reactions ("Blått hjärta, 1"), and contains the word
 * it shows on wider screens ("Kommentarer").
 */
export function commentsLinkLabel(count: number | null | undefined): string {
  return `Visa kommentarer, ${count ?? 'okänt antal'}`
}

export interface PostStats { reactions: Record<ReactionKey, number>, comments: number }

/**
 * The comment a reply answers, as stored (parent_comment_id), never guessed
 * from an @mention: its id, and its author's current handle (null when it
 * couldn't be read just now).
 */
export interface ReplyTarget { id: string, handle: string | null }

export interface RealComment {
  id: string
  postId: string
  author: PublicAuthor
  body: string
  createdAt: string
  /** Published as a reply (is_reply). Stays true after the answered comment is deleted. */
  isReply: boolean
  /** What it answers, while that comment exists; null for an ordinary comment and for a reply to a deleted one. */
  replyTo: ReplyTarget | null
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** At most this many comments are fetched per thread, oldest first. */
export const COMMENT_LIMIT = 200

interface CommentCursor { createdAt: string, id: string }
/**
 * `more`: the last page hit COMMENT_LIMIT, so later comments are not shown yet
 * (loadMoreComments fetches them, after `cursor`, the last row read).
 */
interface CommentThread { status: LoadStatus, list: RealComment[], more: boolean, cursor?: CommentCursor, loadingMore?: boolean }

/*
 * parent_comment_id and is_reply: see 20261116120000_comment_replies.sql. The
 * answered comment's author isn't embedded: PostgREST doesn't offer the
 * self-referencing (parent_comment_id, post_id) key as a relationship, so it
 * is looked up among the comments read (a parent is always older than its
 * reply, so normally already in the thread), or else read by id.
 */
const COMMENT_COLUMNS = 'id, post_id, body, created_at, parent_comment_id, is_reply, author:profiles!post_comments_author_id_fkey(id, display_name, handle, avatar)'
/** A database without the supporter-profiles migration yet (42703: no avatar column): read what it has. */
export const COMMENT_COLUMNS_BEFORE_DESIGN = COMMENT_COLUMNS.replace(', avatar)', ')')
const missingColumn = (e: unknown) => (e as { code?: string } | null)?.code === '42703'

interface CommentRow {
  id: string
  post_id: string
  body: string
  created_at: string
  /** Absent on a database without the replies migration: read as an ordinary comment. */
  parent_comment_id?: string | null
  is_reply?: boolean | null
  author: AuthorRow | AuthorRow[] | null
}

interface StatsRow { post_id: string, hjarta: number, eld: number, stjarna: number, tarar: number, comments: number }

export function toRealComment(r: CommentRow): RealComment | null {
  const a = Array.isArray(r.author) ? r.author[0] : r.author
  if (!a) return null
  const parent = r.parent_comment_id ?? null
  return {
    id: r.id,
    postId: r.post_id,
    author: toAuthor(a),
    body: r.body,
    createdAt: r.created_at,
    isReply: !!r.is_reply || !!parent,
    // The handle is filled in from the comment itself (see withParents)
    replyTo: parent ? { id: parent, handle: null } : null,
  }
}

/** A failed reply because the comment it answers is gone (the foreign key, or the reply guard's own check). */
export const parentGone = (e: DataError | undefined) =>
  e?.code === '23503' && /post_comments_parent_fkey|comment being answered/.test(`${e.message ?? ''} ${e.details ?? ''}`)

const emptyStats = (): PostStats => ({ reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: 0 })

interface DataError { code?: string, message?: string, details?: string, status?: number }
const offline = (e: DataError | undefined) => /fetch|network|load failed|timed? ?out/i.test(`${e?.message ?? ''}`)

export function reactErrorMessage(e: DataError | undefined): string {
  if (offline(e)) return 'Ingen kontakt med servern. Försök igen.'
  if (e?.code === 'PGRST301' || e?.code === 'PGRST303' || /jwt/i.test(`${e?.message ?? ''}`) || e?.status === 401) return 'Du har blivit utloggad. Logga in igen.'
  if (e?.code === '42501') return 'Ditt konto kan inte reagera just nu.'
  if (e?.code === '23503') return 'Inlägget finns inte längre.'
  return 'Det gick inte att reagera. Försök igen.'
}

export const POST_GONE_MESSAGE = 'Inlägget finns inte längre. Din kommentar finns kvar här.'
export const PARENT_GONE_MESSAGE = 'Kommentaren du svarar på finns inte längre. Din kommentar finns kvar här.'

export function commentErrorMessage(e: DataError | undefined): string {
  if (parentGone(e)) return PARENT_GONE_MESSAGE
  if (e?.code === '23503') return POST_GONE_MESSAGE
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

  /**
   * Each reply's answered comment, with its author's current handle: from the
   * comments already read (`known`, and the list itself), else read by id. A
   * parent that's no longer there makes it a reply to a deleted comment
   * (replyTo null); one that couldn't be read just now keeps handle null.
   */
  async function withParents(list: RealComment[], known: RealComment[]): Promise<RealComment[]> {
    const handles = new Map([...known, ...list].map(c => [c.id, c.author.handle] as const))
    const missing = [...new Set(list.flatMap(c => (c.replyTo && !handles.has(c.replyTo.id) ? [c.replyTo.id] : [])))]
    const seen = new Set<string>()
    let read = !missing.length
    if (missing.length && client) {
      try {
        for (let i = 0; i < missing.length; i += 100) {
          const { data, error: e } = await client.from('post_comments').select('id, author:profiles!post_comments_author_id_fkey(handle)').in('id', missing.slice(i, i + 100))
          if (e) throw e
          for (const r of (data ?? []) as unknown as { id: string, author: { handle: string } | { handle: string }[] | null }[]) {
            seen.add(r.id)
            const a = Array.isArray(r.author) ? r.author[0] : r.author
            if (a) handles.set(r.id, a.handle)
          }
        }
        read = true
      }
      catch { /* not known just now: shown without a handle */ }
    }
    return list.map((c) => {
      if (!c.replyTo) return c
      const id = c.replyTo.id
      if (read && !handles.has(id) && !seen.has(id)) return { ...c, replyTo: null } // gone
      return { ...c, replyTo: { id, handle: handles.get(id) ?? null } }
    })
  }

  /** One page of a thread, oldest first, after `after` (keyset: created_at, then id). */
  async function commentPage(postId: string, after?: CommentCursor) {
    const list = (cols: string) => {
      let q = client!.from('post_comments').select(cols).eq('post_id', postId)
      // Quoted: timestamps contain dots, colons and '+'.
      if (after) q = q.or(`created_at.gt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.gt.${after.id})`)
      return q.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(COMMENT_LIMIT)
    }
    let { data, error: e } = await list(COMMENT_COLUMNS)
    if (missingColumn(e)) ({ data, error: e } = await list(COMMENT_COLUMNS_BEFORE_DESIGN))
    if (e) throw e
    const rows = data as unknown as CommentRow[]
    const last = rows.at(-1)
    const comments = rows.map(toRealComment).filter((c): c is RealComment => !!c)
    return {
      list: await withParents(comments, after ? threads.value[postId]?.list ?? [] : []),
      more: rows.length >= COMMENT_LIMIT,
      // From the rows themselves: a row skipped for want of a visible author still moves the page on.
      cursor: last ? { createdAt: last.created_at, id: last.id } : after,
    }
  }

  async function loadComments(postId: string) {
    if (!client) return
    const prev = threads.value[postId]
    threads.value = { ...threads.value, [postId]: { ...(prev ?? { list: [], more: false }), status: prev?.list.length ? 'ready' : 'loading' } }
    try {
      const first = await commentPage(postId)
      // The total stays post_stats()'s: this list is a capped page (and skips
      // rows without a visible author), so its length is not a count.
      threads.value = { ...threads.value, [postId]: { status: 'ready', list: first.list, more: first.more, cursor: first.cursor } }
    }
    catch {
      threads.value = { ...threads.value, [postId]: { ...(prev ?? { list: [], more: false }), status: prev?.list.length ? 'ready' : 'error' } }
    }
  }

  /**
   * The next COMMENT_LIMIT comments of a capped thread, after the last one
   * shown (oldest first). False when it couldn't: what's shown stays.
   */
  async function loadMoreComments(postId: string): Promise<boolean> {
    const t = threads.value[postId]
    if (!client || !t || t.status !== 'ready' || !t.more || t.loadingMore) return false
    threads.value = { ...threads.value, [postId]: { ...t, loadingMore: true } }
    try {
      const next = await commentPage(postId, t.cursor)
      const now = threads.value[postId] ?? t
      const seen = new Set(now.list.map(c => c.id))
      threads.value = { ...threads.value, [postId]: { ...now, list: [...now.list, ...next.list.filter(c => !seen.has(c.id))], more: next.more, cursor: next.cursor, loadingMore: false } }
      return true
    }
    catch {
      const now = threads.value[postId] ?? t
      threads.value = { ...threads.value, [postId]: { ...now, loadingMore: false } }
      return false
    }
  }

  /**
   * Comment as the signed-in supporter. Shown only once Supabase confirms it,
   * and only in its place: the newest comment goes last. While later comments
   * aren't loaded yet (`more`), it isn't put after the ones that are; the next
   * pages bring it, in order. `id`: the comment, as published.
   *
   * `parentId`: the comment it answers (a reply). Sent as is; the database
   * checks it's a comment on this post. A reply that can't be published is
   * never sent again as an ordinary comment.
   */
  async function addComment(postId: string, input: string, parentId?: string | null): Promise<{ ok: true, id: string } | { ok: false, message: string }> {
    if (!canInteract()) return { ok: false, message: 'Logga in och välj ditt läktarnamn för att kommentera.' }
    if (sending.value[postId]) return { ok: false, message: 'Skickar redan…' }
    const body = normalizePostBody(input)
    const invalid = validatePostBody(body)
    if (invalid) return { ok: false, message: invalid }
    sending.value = { ...sending.value, [postId]: true }
    try {
      // No author_id: the database sets it from the session and checks it.
      // An ordinary comment sends exactly what it always has.
      const values: Record<string, string> = parentId ? { post_id: postId, body, parent_comment_id: parentId } : { post_id: postId, body }
      const insert = (cols: string) => client!.from('post_comments').insert(values).select(cols).single()
      let { data, error: e } = await insert(COMMENT_COLUMNS)
      // A database without the avatar column yet. The insert and the columns it
      // returns are one SQL statement, so that error means nothing was saved:
      // asking again with the columns it has can't comment twice.
      if (missingColumn(e)) ({ data, error: e } = await insert(COMMENT_COLUMNS_BEFORE_DESIGN))
      if (e) throw e
      const row = toRealComment(data as unknown as CommentRow)
      if (!row) throw new Error('no author')
      const [c] = await withParents([row], threads.value[postId]?.list ?? []) as [RealComment]
      const t = threads.value[postId] ?? { status: 'ready' as const, list: [], more: false }
      if (!t.more) threads.value = { ...threads.value, [postId]: { ...t, status: 'ready', list: [...t.list.filter(x => x.id !== c.id), c] } }
      const s = stats.value[postId] ?? emptyStats()
      stats.value = { ...stats.value, [postId]: { ...s, comments: s.comments + 1 } }
      return { ok: true, id: c.id }
    }
    catch (e) {
      // The answered comment is gone: perhaps with the whole post. Say which.
      if (parentGone(e as DataError) && await postMissing(postId)) return { ok: false, message: POST_GONE_MESSAGE }
      return { ok: false, message: commentErrorMessage(e as DataError) }
    }
    finally {
      const { [postId]: _, ...rest } = sending.value
      sending.value = rest
    }
  }

  /** Is the post gone? Only a definite "no such post" says yes. */
  async function postMissing(postId: string) {
    try {
      const { data, error: e } = await client!.from('posts').select('id').eq('id', postId).maybeSingle()
      return !e && !data
    }
    catch {
      return false
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
      // Its replies stay, now replies to a deleted comment (the database cleared their reference too).
      if (t) threads.value = { ...threads.value, [postId]: { ...t, list: t.list.filter(c => c.id !== commentId).map(c => (c.replyTo?.id === commentId ? { ...c, replyTo: null } : c)) } }
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

  return { stats, statsStatus, statsLoadedAt, mine, pending, threads, sending, loadStats, loadMine, react, loadComments, loadMoreComments, addComment, removeComment }
}

export type InteractionsStore = ReturnType<typeof createInteractions>
