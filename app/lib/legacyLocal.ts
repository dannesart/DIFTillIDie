import type { Sport } from '#shared/types/domain'
import type { LocalOwner } from './localScope'
import { scopedKey } from './localScope'

/*
 * Posts written before Snacket became real were saved only in the browser,
 * per owner (the guest under the original key, each account under its own).
 * They were never published and never will be automatically: this module
 * only reads them, for their writer, and removes one when they explicitly
 * ask. Everything else in the stored bucket (old reactions, comments on the
 * retired fictional posts, the guest name) is left exactly as it was.
 */

export const LEGACY_KEY = 'djurgarn:snacket:v1'

export interface LegacyComment { id: string, authorName: string, body: string, createdAt: string }

export interface LegacyLocalPost {
  id: string
  body: string
  createdAt: string
  sport?: Sport
  storyId?: string
  /** Comments written on this local post, also only in this browser. */
  comments: LegacyComment[]
}

interface StoredPost { id?: unknown, body?: unknown, createdAt?: unknown, sport?: unknown, storyId?: unknown }
interface StoredComment { id?: unknown, body?: unknown, createdAt?: unknown, author?: { name?: unknown } }
interface Bucket { posts?: StoredPost[], comments?: Record<string, StoredComment[]>, [k: string]: unknown }

function readBucket(storage: Pick<Storage, 'getItem'> | undefined, key: string): Bucket | null {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return null
    const b = JSON.parse(raw) as Bucket
    return b && typeof b === 'object' ? b : null
  }
  catch {
    return null
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** This owner's old local posts, newest first. Unreadable data yields none (and stays untouched). */
export function readLegacyPosts(storage: Pick<Storage, 'getItem'> | undefined, owner: LocalOwner): LegacyLocalPost[] {
  const b = readBucket(storage, scopedKey(LEGACY_KEY, owner))
  if (!b || !Array.isArray(b.posts)) return []
  return b.posts
    .filter(p => str(p.id) && str(p.body))
    .map((p): LegacyLocalPost => ({
      id: str(p.id),
      body: str(p.body),
      createdAt: str(p.createdAt),
      sport: p.sport === 'fotboll' || p.sport === 'hockey' ? p.sport : undefined,
      storyId: str(p.storyId) || undefined,
      comments: (Array.isArray(b.comments?.[str(p.id)]) ? b.comments![str(p.id)]! : [])
        .filter(c => str(c.body))
        .map(c => ({ id: str(c.id), authorName: str(c.author?.name) || 'Du', body: str(c.body), createdAt: str(c.createdAt) })),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Remove one old local post (and the local comments on it) because its
 * writer asked to. The rest of the bucket is written back unchanged.
 */
export function removeLegacyPost(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, owner: LocalOwner, id: string): boolean {
  const key = scopedKey(LEGACY_KEY, owner)
  const b = readBucket(storage, key)
  if (!b || !Array.isArray(b.posts) || !b.posts.some(p => p.id === id)) return false
  const comments = { ...(b.comments ?? {}) }
  delete comments[id]
  try {
    storage!.setItem(key, JSON.stringify({ ...b, posts: b.posts.filter(p => p.id !== id), comments }))
    return true
  }
  catch {
    return false
  }
}
