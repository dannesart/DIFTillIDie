import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { PostStats } from '../app/lib/interactions'
import type { FeedSort } from '../app/lib/feedSort'
import { applyOrder, createFeedSort, engagement, heat, rankHot } from '../app/lib/feedSort'

/* Hetast / Nyast on the real Snacket feed. */

const NOW = Date.parse('2026-11-03T20:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const stat = (reactions: number, comments = 0): PostStats =>
  ({ reactions: { hjarta: reactions, eld: 0, stjarna: 0, tarar: 0 }, comments })

// Newest first, the way Supabase returns them.
const posts = [
  { id: 'a', createdAt: hoursAgo(0.2), sport: 'fotboll' },
  { id: 'b', createdAt: hoursAgo(1), sport: 'hockey' },
  { id: 'c', createdAt: hoursAgo(3), sport: 'fotboll' },
  { id: 'd', createdAt: hoursAgo(30), sport: 'hockey' },
]

describe('the ranking', () => {
  it('counts reactions once and comments twice', () => {
    expect(engagement(stat(3, 2))).toBe(7)
    expect(engagement(undefined)).toBe(0)
  })

  it('without any engagement, Hetast is exactly newest first', () => {
    expect(rankHot(posts, {}, NOW)).toEqual(['a', 'b', 'c', 'd'])
    expect(rankHot(posts, { a: stat(0), b: stat(0), c: stat(0), d: stat(0) }, NOW)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('real engagement lifts a post above newer quiet ones', () => {
    expect(rankHot(posts, { c: stat(4, 1) }, NOW)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('a comment weighs more than a reaction', () => {
    const two = [{ id: 'x', createdAt: hoursAgo(1) }, { id: 'y', createdAt: hoursAgo(1) }]
    expect(rankHot(two, { x: stat(1), y: stat(0, 1) }, NOW)).toEqual(['y', 'x'])
  })

  it('cools with age: yesterday’s handful doesn’t beat tonight’s', () => {
    expect(heat(stat(5), hoursAgo(30), NOW)).toBeLessThan(heat(stat(2), hoursAgo(1), NOW))
    expect(rankHot(posts, { d: stat(5), b: stat(2) }, NOW)[0]).toBe('b')
  })

  it('equal heat falls back to newest first', () => {
    const twins = [{ id: 'old', createdAt: hoursAgo(2) }, { id: 'new', createdAt: hoursAgo(1) }]
    const same = { old: stat(0), new: stat(0) }
    expect(rankHot(twins, same, NOW)).toEqual(['new', 'old'])
  })
})

describe('applying an order', () => {
  it('filters are applied first: ordering a filtered list keeps only it, in ranked order', () => {
    const order = rankHot(posts, { c: stat(4, 1), d: stat(9) }, NOW)
    const fotboll = posts.filter(p => p.sport === 'fotboll')
    expect(applyOrder(fotboll, order).map(p => p.id)).toEqual(['c', 'a'])
  })

  it('posts the snapshot hasn’t seen (just published) lead, newest first', () => {
    const order = ['c', 'a', 'b', 'd']
    const withNew = [{ id: 'n2', createdAt: hoursAgo(0) }, { id: 'n1', createdAt: hoursAgo(0.1) }, ...posts]
    expect(applyOrder(withNew, order).map(p => p.id)).toEqual(['n2', 'n1', 'c', 'a', 'b', 'd'])
  })
})

function setup(sort: FeedSort = 'nyast') {
  const s = {
    sort: ref<FeedSort>(sort),
    posts: ref(posts),
    stats: ref<Record<string, PostStats>>({}),
    statsStatus: ref<'idle' | 'loading' | 'ready' | 'error'>('loading'),
    statsLoadedAt: ref<number | null>(null),
  }
  const fs = createFeedSort({ ...s, now: () => NOW })
  const ids = () => fs.apply(posts).map(p => p.id)
  const deliver = (stats: Record<string, PostStats>) => {
    s.stats.value = stats
    s.statsStatus.value = 'ready'
    s.statsLoadedAt.value = (s.statsLoadedAt.value ?? 0) + 1
  }
  return { ...s, fs, ids, deliver }
}

describe('the feed’s sort state', () => {
  it('Nyast is the default and keeps Supabase’s order, totals or not', () => {
    const t = setup()
    expect([t.fs.state.value, t.ids()]).toEqual(['newest', ['a', 'b', 'c', 'd']])
    t.deliver({ c: stat(9) })
    expect([t.fs.state.value, t.ids()]).toEqual(['newest', ['a', 'b', 'c', 'd']])
  })

  it('Hetast while totals are loading says so and stays newest first', () => {
    const t = setup('hetast')
    expect([t.fs.state.value, t.ids()]).toEqual(['waiting', ['a', 'b', 'c', 'd']])
    t.deliver({ c: stat(4, 1) })
    expect([t.fs.state.value, t.ids()]).toEqual(['ranked', ['c', 'a', 'b', 'd']])
  })

  it('Hetast without totals (post_stats failed) is honest about it', () => {
    const t = setup('hetast')
    t.statsStatus.value = 'error'
    expect([t.fs.state.value, t.ids()]).toEqual(['unavailable', ['a', 'b', 'c', 'd']])
  })

  it('reacting or commenting does not reorder the feed under you', () => {
    const t = setup('hetast')
    t.deliver({ c: stat(4, 1) })
    // Your own tap (react/addComment) updates stats in place, nothing else.
    t.stats.value = { ...t.stats.value, d: stat(200, 50) }
    expect(t.ids()).toEqual(['c', 'a', 'b', 'd'])
    // Fresh totals from Supabase (a refresh) do re-rank.
    t.deliver(t.stats.value)
    expect(t.ids()[0]).toBe('d')
  })

  it('switching to Hetast takes a fresh snapshot; back to Nyast restores newest first', () => {
    const t = setup()
    t.deliver({ b: stat(6) })
    t.sort.value = 'hetast'
    expect(t.ids()).toEqual(['b', 'a', 'c', 'd'])
    t.sort.value = 'nyast'
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd'])
  })
})
