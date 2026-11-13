import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FrozenStory, SourceArticle, Story } from '../shared/types/domain'
import type { PostStoryEvidence } from '../shared/utils/story'
import { postsAboutStory, postsForStoryFilter, storyOfPost } from '../shared/utils/story'
import { freezeStory } from '../server/lib/capture'
import { toCommunityPost } from '../app/lib/posts'
import { article } from './helpers'

/*
 * Which live Story a published post is about (Issue #25, policy C). A post with a frozen Story follows its
 * lead article; it never falls back to its storyId (the Story's earliest article), which a regrouping can
 * put in another event's Story. A post from before frozen Stories keeps resolving by its storyId.
 * Stories are built explicitly here, so these hold whatever partition grouping makes.
 */

const at = (h: number) => new Date(Date.UTC(2026, 10, 9, 22) + h * 3_600_000).toISOString()
// Shaped like the real 13 November Story: the earliest article is another event than the lead
const A = article({ headline: 'Expert: tränaren lämnar efter säsongen', publishedAt: at(0), reporting: 'compiled', legacyId: 'leg-a' })
const B = article({ headline: 'Officiellt: tränaren sparkas', publishedAt: at(12), reporting: 'compiled' })
const I = article({ headline: 'Sportchefen förklarar varför tränaren sparkades', publishedAt: at(37), reporting: 'original' })
const M = article({ headline: 'Inför bortamatchen mot Sirius', publishedAt: at(47), reporting: 'compiled' })
const X = article({ headline: 'En annan händelse', publishedAt: at(30) })

/** A Story as grouping makes one: id from the earliest article, original reporting leads. */
function story(sources: SourceArticle[]): Story {
  const s = [...sources].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt))
  return { id: `story-${s[0]!.id}`, sport: s[0]!.sport, sources: s, leadId: (s.find(a => a.reporting === 'original') ?? s[0]!).id, sharedNames: [], updatedAt: s.at(-1)!.publishedAt }
}
const deepFreeze = <T>(o: T): T => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o) } return o }

// A supporter attached the whole Story (lead I, earliest A) and published
const attached = story([A, B, I, M])
const frozen: FrozenStory = deepFreeze(freezeStory(attached, 'k1', []))
const modern = deepFreeze({ storyId: attached.id, storyRef: frozen })
const legacy = deepFreeze({ storyId: attached.id })
const snapshot = JSON.stringify(frozen)

describe('a post with a frozen Story follows its lead article', () => {
  it('is the frozen lead, found by its article id (not the earliest article)', () => {
    expect(frozen.storyId).toBe(`story-${A.id}`)
    expect(frozen.sources.find(s => s.key === frozen.leadKey)!.id).toBe(I.id)
  })

  const cases: [string, Story[], Story | undefined][] = (() => {
    const unchanged = [story([A, B, I, M])]
    const split = [story([A]), story([B, I]), story([M])]
    const earliestGone = [story([B, I, M])]
    const leadGoneSplit = [story([A]), story([B]), story([M])]
    const leadGoneTogether = [story([A, B, M])]
    const merged = [story([A, B, I, M, X])]
    return [
      ['unchanged', unchanged, unchanged[0]],
      ['split: the part holding the lead, not the earliest article\'s', split, split[1]],
      ['the earliest article left the feeds, the lead is still there', earliestGone, earliestGone[0]],
      ['the lead left; the rest split up: nothing, not the earliest article\'s Story', leadGoneSplit, undefined],
      ['the lead left; the rest still together: nothing (other sources are no proof)', leadGoneTogether, undefined],
      ['every captured article left the feeds', [story([X])], undefined],
      ['merged with another Story: the merged Story', merged, merged[0]],
    ]
  })()
  for (const [name, live, want] of cases) {
    it(name, () => {
      expect(storyOfPost(live, modern)).toBe(want)
      expect(JSON.stringify(modern.storyRef)).toBe(snapshot)
    })
  }

  it('never matches an unrelated Story, even one with the post\'s old storyId', () => {
    // After the split, the earliest article's Story still has exactly the post's storyId
    const split = [story([A]), story([B, I]), story([M])]
    expect(split[0]!.id).toBe(modern.storyId)
    expect(storyOfPost(split, modern)).not.toBe(split[0])
    // An id that only starts like the lead's is another article
    const lookalike = article({ headline: 'Liknande id', id: `${I.id}0` })
    expect(storyOfPost([story([lookalike])], modern)).toBeUndefined()
  })

  it('is nothing when the lead evidence is missing or incomplete, never a guess', () => {
    const live = [story([A, B, I, M])]
    const withRef = (storyRef: unknown): PostStoryEvidence => ({ storyId: attached.id, storyRef: storyRef as FrozenStory })
    expect(storyOfPost(live, withRef({ ...frozen, leadKey: 'f'.repeat(64) }))).toBeUndefined()
    expect(storyOfPost(live, withRef({ ...frozen, leadKey: undefined }))).toBeUndefined()
    expect(storyOfPost(live, withRef({ ...frozen, sources: frozen.sources.map(s => (s.key === frozen.leadKey ? { ...s, id: undefined } : s)) }))).toBeUndefined()
    expect(storyOfPost(live, withRef({ ...frozen, sources: 'nope' }))).toBeUndefined()
    // A frozen Story that was stored but couldn't be read is not a legacy post: not found by its storyId
    expect(storyOfPost(live, { storyId: attached.id, storyRefInvalid: true })).toBeUndefined()
  })
})

describe('a post from before frozen Stories keeps resolving by its storyId', () => {
  it('finds the Story holding the referenced article, as before', () => {
    const split = [story([A]), story([B, I]), story([M])]
    expect(storyOfPost([attached], legacy)).toBe(attached)
    expect(storyOfPost(split, legacy)).toBe(split[0])
    expect(storyOfPost([story([B, I, M])], legacy)).toBeUndefined()
    expect(storyOfPost([attached], {})).toBeUndefined()
  })

  it('by a legacy id only when exactly one Story answers to it', () => {
    expect(storyOfPost([attached], { storyId: 'story-leg-a' })).toBe(attached)
    const twin = article({ headline: 'Samma gamla id', legacyId: 'leg-a', publishedAt: at(90) })
    expect(storyOfPost([attached, story([twin])], { storyId: 'story-leg-a' })).toBeUndefined()
  })
})

describe('links, counts, the Story filter and earlier posts agree', () => {
  const lateLead = deepFreeze({ storyId: `story-${M.id}`, storyRef: freezeStory(story([M]), 'k1', []) })
  const other = deepFreeze({ storyId: story([X]).id })
  const plain = deepFreeze({})
  const posts: PostStoryEvidence[] = [modern, legacy, lateLead, other, plain, { storyId: attached.id, storyRefInvalid: true }]
  const groupings: [string, Story[]][] = [
    ['unchanged', [story([A, B, I, M]), story([X])]],
    ['split', [story([A]), story([B, I]), story([M]), story([X])]],
    ['lead gone', [story([A, B, M]), story([X])]],
  ]
  for (const [name, live] of groupings) {
    it(`${name}: every post counts for at most one Story, the one its link opens`, () => {
      for (const s of live) {
        const about = postsAboutStory(live, posts, s)
        // The count and the dialog's earlier posts (postsForStory) are this list; the filter shows the same
        expect(about).toEqual(posts.filter(p => storyOfPost(live, p) === s))
        expect(postsForStoryFilter(live, posts, s.id)).toEqual(about)
      }
      const counted = live.flatMap(s => postsAboutStory(live, posts, s))
      expect(new Set(counted).size).toBe(counted.length)
      expect(counted).toEqual(expect.arrayContaining(posts.filter(p => storyOfPost(live, p))))
    })
  }

  it('a filter on a Story that left the feeds matches only legacy posts with exactly that id', () => {
    const live = [story([B, I, M])]
    expect(postsForStoryFilter(live, posts, attached.id)).toEqual([legacy])
  })

  it('a split never moves the published post to the earliest article\'s Story', () => {
    const split = [story([A]), story([B, I]), story([M])]
    expect(postsAboutStory(split, [modern], split[0]!)).toEqual([])
    expect(postsAboutStory(split, [modern], split[1]!)).toEqual([modern])
  })

  it('leaves the frozen attachments exactly as published', () => {
    for (const [, live] of groupings) for (const p of posts) storyOfPost(live, p)
    expect(JSON.stringify(modern.storyRef)).toBe(snapshot)
  })
})

describe('reading a post\'s frozen Story', () => {
  const row = (story_ref: unknown) => ({ id: 'p1', body: 'Hej', sport: 'fotboll', story_id: 'story-x', story_ref, created_at: at(0), author: { id: 'u1', display_name: 'Lotta', handle: 'lotta' } })

  it('marks a stored but unreadable frozen Story, so it is never taken for a legacy post', () => {
    expect(toCommunityPost(row({ sources: [] }) as never)).toMatchObject({ storyRefInvalid: true, storyRef: undefined })
    expect(toCommunityPost(row('kaos') as never)!.storyRefInvalid).toBe(true)
  })

  it('a legacy post (no frozen Story) and a readable one are not marked', () => {
    expect(toCommunityPost(row(null) as never)!.storyRefInvalid).toBeUndefined()
    expect(toCommunityPost(row(undefined) as never)!.storyRefInvalid).toBeUndefined()
    expect(toCommunityPost(row(JSON.parse(snapshot)) as never)!.storyRefInvalid).toBeUndefined()
  })
})

describe('every Story association goes through storyOfPost', () => {
  const src = (f: string) => readFileSync(f, 'utf8')

  it('PostCard links the Story storyOfPost finds, and says so calmly when there is none', () => {
    const card = src('app/components/PostCard.vue')
    expect(card).toMatch(/const live = computed\(\(\) => storyOfPost\(stories\.value, props\.post\)\)/)
    expect(card).toContain('Ingen aktuell Story kan kopplas säkert till det här inlägget.')
    expect(card).not.toMatch(/findStory\([^)]*post\.storyId/)
  })

  it('Snacket\'s filter, counts and earlier posts use the shared functions; the ordinary feed keeps every post', () => {
    const snacket = src('app/composables/useSnacket.ts')
    expect(snacket).toContain('postsForStoryFilter(')
    expect(snacket).toMatch(/const postsForStory = \(story: Story\) => postsAboutStory\(/)
    expect(snacket).toMatch(/const countForStory = \(story: Story\) => postsForStory\(story\)\.length/)
    // No Story filter: no post is left out for lacking a live Story
    expect(snacket).toContain('&& (!about || about.has(p))')
    expect(snacket).not.toMatch(/findStory\([^)]*p\.storyId/)
  })

  it('Hem and supporters\' pages carry the same evidence', () => {
    expect(src('app/shell/views/Hem.vue')).toContain('storyOfPost(stories.value, post)')
    expect(src('app/components/SupporterPlace.vue')).toContain('storyRefInvalid: p.storyRefInvalid')
  })
})
