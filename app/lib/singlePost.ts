import type { SupabaseClient } from '@supabase/supabase-js'
import { ref } from 'vue'
import type { CommunityPost, PostRow } from './posts'
import { COLUMNS, COLUMNS_BEFORE_DESIGN, toCommunityPost } from './posts'
import { isUserId as isUuid } from './wall'

/*
 * One Snacket post on a page of its own (/snacket/inlagg/<post id>), read
 * straight from Supabase by its id, whatever Snacket has loaded. Posts and
 * comments are readable by everyone, so this is the same read as the feed's,
 * for one row; nothing new is asked of the database.
 *
 * A comment link (#comment-<id>) is checked the same way: does that comment
 * exist, on this post? Only then is it searched for in the thread; a comment
 * that's gone is said to be gone, never replaced by another one.
 */

/** 'removed': you deleted it here, just now. */
export type SinglePostStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'removed' | 'error'
/** 'present': on this post. 'missing': deleted, never existed, or on another post. */
export type CommentCheck = 'none' | 'checking' | 'present' | 'missing' | 'error'

interface DataError { code?: string }
const missingColumn = (e: unknown) => (e as DataError | null)?.code === '42703'

/** The comment a link points at (#comment-<uuid>), or null. Anything else in the hash is no comment. */
export function commentFromHash(hash: string): string | null {
  const m = /^#comment-([0-9a-f-]{36})$/i.exec(hash)
  return m && isUuid(m[1]!) ? m[1]!.toLowerCase() : null
}

export function createSinglePost(client: SupabaseClient | null, postId: string) {
  const status = ref<SinglePostStatus>('idle')
  const post = ref<CommunityPost | null>(null)
  const comment = ref<CommentCheck>('none')
  let request = 0

  async function load() {
    if (!isUuid(postId)) return void (status.value = 'missing')
    if (!client) return void (status.value = 'error')
    const mine = ++request
    if (status.value !== 'ready') status.value = 'loading'
    try {
      const one = (cols: string) => client.from('posts').select(cols).eq('id', postId.toLowerCase()).maybeSingle()
      let { data, error: e } = await one(COLUMNS)
      if (missingColumn(e)) ({ data, error: e } = await one(COLUMNS_BEFORE_DESIGN))
      if (e) throw e
      if (mine !== request) return
      // No such post (deleted, or never was), or one without a visible author: nothing honest to show.
      const found = data ? toCommunityPost(data as unknown as PostRow) : null
      post.value = found
      status.value = found ? 'ready' : 'missing'
    }
    catch {
      if (mine === request) status.value = 'error'
    }
  }

  /** Is `commentId` a comment on this post, right now? */
  async function checkComment(commentId: string | null) {
    if (!commentId) return void (comment.value = 'none')
    if (!client) return void (comment.value = 'error')
    comment.value = 'checking'
    try {
      const { data, error: e } = await client.from('post_comments').select('id').eq('id', commentId).eq('post_id', postId.toLowerCase()).maybeSingle()
      if (e) throw e
      comment.value = data ? 'present' : 'missing'
    }
    catch {
      comment.value = 'error'
    }
  }

  /** Deleted here, by its author: the page says so. */
  function removed() {
    post.value = null
    status.value = 'removed'
  }

  return { status, post, comment, load, checkComment, removed }
}

export type SinglePostStore = ReturnType<typeof createSinglePost>
