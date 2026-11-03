import type { Ref } from 'vue'
import { computed, ref, watch } from 'vue'
import type { PostStats } from './interactions'

/*
 * Hetast / Nyast for Snacket på stan.
 *
 * Hetast ranks only the posts already loaded (the newest 50), by what
 * supporters actually did with them, cooled by age:
 *
 *   heat = (reactions + 2 × comments + 1) / (hours since posted + 2) ^ 1.4
 *
 * With no engagement anywhere this is simply newest first; ties are too.
 *
 * The order is a snapshot: it's taken when you pick Hetast and when fresh
 * totals arrive from Supabase, never on a single reaction or comment, so a
 * post doesn't jump away from under someone reacting to it or reading its
 * comments.
 */

export type FeedSort = 'nyast' | 'hetast'

export const HOT_WEIGHTS = { reaction: 1, comment: 2 } as const

interface Ranked { id: string, createdAt: string }

export function engagement(s: PostStats | undefined): number {
  if (!s) return 0
  const reactions = Object.values(s.reactions).reduce((a, b) => a + b, 0)
  return reactions * HOT_WEIGHTS.reaction + s.comments * HOT_WEIGHTS.comment
}

export function heat(s: PostStats | undefined, createdAt: string, now: number): number {
  const hours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000)
  return (engagement(s) + 1) / Math.pow(hours + 2, 1.4)
}

const newestFirst = (a: Ranked, b: Ranked) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)

/** Post ids, hottest first; equal heat falls back to newest first. */
export function rankHot(posts: Ranked[], stats: Record<string, PostStats>, now: number): string[] {
  return posts
    .map(p => ({ p, h: heat(stats[p.id], p.createdAt, now) }))
    .sort((a, b) => b.h - a.h || newestFirst(a.p, b.p))
    .map(x => x.p.id)
}

/**
 * Order `list` (already filtered) by a ranking snapshot. Posts the snapshot
 * hasn't seen yet are the newest ones, so they lead, newest first.
 */
export function applyOrder<T extends Ranked>(list: T[], order: string[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]))
  const fresh = list.filter(p => !at.has(p.id)).sort(newestFirst)
  const known = list.filter(p => at.has(p.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!)
  return [...fresh, ...known]
}

/**
 * - 'newest': Nyast.
 * - 'ranked': Hetast, from confirmed totals.
 * - 'waiting' / 'unavailable': Hetast was picked but there are no totals
 *   (yet / right now), so the feed honestly stays newest first.
 */
export type SortState = 'newest' | 'ranked' | 'waiting' | 'unavailable'

export function createFeedSort(opts: {
  sort: Ref<FeedSort>
  posts: Ref<Ranked[]>
  stats: Ref<Record<string, PostStats>>
  statsStatus: Ref<'idle' | 'loading' | 'ready' | 'error'>
  /** Changes whenever post_stats() has delivered fresh totals. */
  statsLoadedAt: Ref<number | null>
  now?: () => number
}) {
  const now = opts.now ?? Date.now
  const order = ref<string[] | null>(null)

  function snapshot() {
    order.value = opts.sort.value === 'hetast' && opts.statsStatus.value === 'ready'
      ? rankHot(opts.posts.value, opts.stats.value, now())
      : null
  }
  // Not on `stats` itself: a reaction or comment updates it, and must not reorder.
  watch([opts.sort, opts.statsStatus, opts.statsLoadedAt], snapshot, { immediate: true, flush: 'sync' })

  const state = computed<SortState>(() => {
    if (opts.sort.value === 'nyast') return 'newest'
    if (order.value) return 'ranked'
    return opts.statsStatus.value === 'error' ? 'unavailable' : 'waiting'
  })

  /** The feed in the chosen order. Nyast (and Hetast without totals) keeps Supabase's newest-first order. */
  const apply = <T extends Ranked>(list: T[]): T[] => (order.value ? applyOrder(list, order.value) : list)

  return { state, apply }
}
