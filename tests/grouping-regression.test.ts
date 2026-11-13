import { describe, expect, it } from 'vitest'
import type { SourceArticle, Story } from '../shared/types/domain'
import { groupIntoStories, namesIn } from '../server/lib/grouping'
import { canonicalUrl } from '../server/lib/news'
import { findStory, storyAnswersTo } from '../shared/utils/story'
import { article, fixtureArticles } from './helpers'

/*
 * Story grouping regression cases (Issue #25), in our own words, shaped like what the real feeds produced
 * (no feed text is copied). Two kinds of expectation:
 *  - `it`: what grouping guarantees today; must keep holding whatever the algorithm becomes.
 *  - `it.fails`, "known gap": what a Story should do but today's algorithm doesn't. Vitest reports these
 *    as passing while the gap is there and as failing once it closes: then turn them into ordinary tests.
 * Event labels here are ours and certain by construction; uncertain real-world cases stay in the issue.
 */

const at = (hours: number) => new Date(Date.UTC(2026, 10, 1, 10) + hours * 3_600_000).toISOString()
const original = (over: Partial<SourceArticle> & Pick<SourceArticle, 'headline'>) => article({ outlet: 'Sportbladet', publisher: 'Aftonbladet', reporting: 'original', ...over })
const compiled = (over: Partial<SourceArticle> & Pick<SourceArticle, 'headline'>) => article({ outlet: 'Bollsvenskan', publisher: 'Bollsvenskan', reporting: 'compiled', ...over })
const storyOf = (stories: Story[], a: SourceArticle) => stories.find(s => s.sources.some(x => x.id === a.id))!
const together = (stories: Story[], a: SourceArticle, b: SourceArticle) => storyOf(stories, a) === storyOf(stories, b)

// One transfer, reported by an outlet and summarised by another
const transfer = [
  original({ headline: 'Klart: Lina Berg lämnar Djurgården för Vålerenga', excerpt: 'Mittfältaren har skrivit på för det norska laget.', publishedAt: at(0) }),
  compiled({ headline: 'Berg bekräftar flytten till Vålerenga', excerpt: 'Lina Berg och Vålerenga är överens, uppger Sportbladet.', publishedAt: at(3) }),
]
// One person, one event: the only shared evidence is her full name
const sacking = [
  compiled({ headline: 'Officiellt: Djurgården sparkar tränaren Jani Mäkinen', excerpt: 'Beslutet togs efter förlusten i helgen.', publishedAt: at(0) }),
  original({ headline: 'Mäkinen om sparken: ”Jag är besviken”', excerpt: 'Jani Mäkinen fick beskedet i morse.', publishedAt: at(4) }),
]
// The same person, two events, the same day: the shared evidence looks exactly like the sacking's
const twoEvents = [
  compiled({ headline: 'Lina Berg lämnar Djurgården för Vålerenga', excerpt: 'Övergången är klar.', publishedAt: at(0) }),
  original({ headline: 'Lina Berg uttagen till landslaget', excerpt: 'Förbundskaptenen tar ut truppen till novembersamlingen.', publishedAt: at(6) }),
]
// A chain: each neighbour links, the ends are 40 hours and two events apart
const chain = [
  compiled({ headline: 'Åberg och Lind rasar mot domaren', excerpt: 'Åberg och Lind efter matchen mot Gais.', publishedAt: at(0) }),
  compiled({ headline: 'Lind om skadan: ”Borta i två veckor”', excerpt: 'Lind och Åberg efter Gais-matchen.', publishedAt: at(20) }),
  compiled({ headline: 'Lind tillbaka i träning', excerpt: 'Lind och Åberg tränar igen inför Elfsborg.', publishedAt: at(40) }),
]
// "Energi" opens a sentence in both teasers: an ordinary word, not a name
const sentenceStart = [
  compiled({ headline: 'Ekdahl om tränarvalet', excerpt: 'Klubben söker en ny tränare. Energi och ledarskap väger tyngst.', publishedAt: at(0) }),
  compiled({ headline: 'Ekdahl inför bortamatchen mot Mjällby', excerpt: 'Laget reser i dag. Energi och fokus, säger han.', publishedAt: at(5) }),
]
const single = [original({ headline: 'Djurgården förlänger med målvakten Nilsson', excerpt: 'Kontraktet gäller till 2028.', publishedAt: at(0) })]
const cases = { transfer, sacking, twoEvents, chain, sentenceStart, single }

describe('grouping guarantees', () => {
  it('groups one event reported by several outlets, leading with original reporting', () => {
    const [story] = groupIntoStories(transfer)
    expect(story!.sources).toHaveLength(2)
    expect(story!.leadId).toBe(transfer[0]!.id)
  })

  it('keeps a one-person event together when only that person\'s full name links its reports', () => {
    // Whatever replaces the name rules must not split this to fix the case below
    expect(groupIntoStories(sacking)).toHaveLength(1)
  })

  it('never links two articles more than 24 hours apart directly', () => {
    expect(groupIntoStories([chain[0]!, chain[2]!])).toHaveLength(2)
  })

  it('keeps a single article as its own valid Story', () => {
    const [story] = groupIntoStories(single)
    expect(story!.sources).toEqual(single)
    expect(story!.sharedNames).toEqual([])
  })

  it('keeps every distinct source article, unchanged, in exactly one Story', () => {
    const all = [...Object.values(cases).flat(), ...fixtureArticles()]
    const stories = groupIntoStories(all)
    const kept = stories.flatMap(s => s.sources)
    expect(kept).toHaveLength(new Set(all.map(a => canonicalUrl(a.url))).size)
    expect(new Set(kept.map(a => a.id)).size).toBe(kept.length)
    // Headlines, links and original/compiled exactly as the source gave them
    for (const a of kept) expect(all).toContainEqual(a)
  })

  it('still finds a Story by any of its articles when a group splits', () => {
    // Today the chain is one Story; a stricter algorithm would split it. References made either way must resolve.
    const merged = groupIntoStories(chain)
    const split = [...groupIntoStories(chain.slice(0, 2)), ...groupIntoStories(chain.slice(2))]
    expect(merged).toHaveLength(1)
    expect(split).toHaveLength(2)
    for (const a of chain) {
      const ref = `story-${a.id}`
      expect(findStory(merged, ref)).toBe(merged[0])
      expect(findStory(split, ref)).toBe(storyOf(split, a))
      expect(split.filter(s => storyAnswersTo(s, ref))).toHaveLength(1)
    }
    // A reference to the merged Story (its earliest article) lands on the part that kept that article
    expect(findStory(split, merged[0]!.id)!.sources).toContain(chain[0])
  })
})

describe('displayed linking names', () => {
  const names = (articles: SourceArticle[]) => groupIntoStories(articles).flatMap(s => s.sharedNames)

  it('joins a first and last name a source writes side by side in one headline or teaser', () => {
    expect(names(sacking)).toContain('Jani Mäkinen')
    expect(names([
      original({ headline: 'Werner utvisad mot Degerfors', excerpt: 'Patrik Werner fick rött efter slutsignalen.' }),
      compiled({ headline: 'Degerfors rasar: Werner stängs av', excerpt: 'Patrik Werner riskerar avstängning.', publishedAt: at(3) }),
    ])).toContain('Patrik Werner')
  })

  it('never joins a headline\'s last word to its teaser\'s first word', () => {
    const shown = names([
      compiled({ headline: 'Hahn: tydligt beslut att entlediga Honkavaara', excerpt: 'Maximilian Hahn motiverar beslutet.' }),
      compiled({ headline: 'Hahn om Honkavaara: ingen anledning att vänta', excerpt: 'Maximilian Hahn förklarar.', publishedAt: at(2) }),
    ])
    expect(shown).not.toContain('Honkavaara Maximilian')
    expect(shown).toEqual(expect.arrayContaining(['Maximilian Hahn', 'Honkavaara']))
  })

  it('never joins words from two different articles', () => {
    // The first teaser ends with "Degerfors", the second headline starts with "Werner"
    const shown = names([
      original({ headline: 'Rött kort för Werner mot Degerfors', excerpt: 'Sportchefen var rasande på Degerfors' }),
      compiled({ headline: 'Werner om Degerfors: ”Jag ber om ursäkt”', excerpt: 'Degerfors sportchef ångrar sig.', publishedAt: at(2) }),
    ])
    expect(shown).not.toContain('Degerfors Werner')
    expect(shown).toEqual(expect.arrayContaining(['Werner', 'Degerfors']))
  })

  it('does not join a name with only part of a longer word', () => {
    expect(names([
      original({ headline: 'Berg och Vålerenga klara', excerpt: 'Nyberg Vålerengas tränare är nöjd.' }),
      compiled({ headline: 'Berg till Vålerenga', excerpt: 'Vålerenga bekräftar.', publishedAt: at(1) }),
    ])).not.toContain('Berg Vålerenga')
  })
})

describe('known gaps (#25): what a Story should do, and grouping does not yet', () => {
  it.fails('keeps the same person\'s two different events apart', () => {
    // Same evidence shape as the sacking above (a full name in both headlines), so name rules alone can't tell them apart
    expect(together(groupIntoStories(twoEvents), twoEvents[0]!, twoEvents[1]!)).toBe(false)
  })

  it.fails('never puts the two ends of a chain, 40 hours and two events apart, in one Story', () => {
    expect(together(groupIntoStories(chain), chain[0]!, chain[2]!)).toBe(false)
  })

  it.fails('does not treat a sentence-initial ordinary word as a name', () => {
    expect([...namesIn('Laget reser i dag. Energi och fokus, säger han.')]).not.toContain('energi')
  })

  it.fails('does not link two articles on a sentence-initial word', () => {
    expect(groupIntoStories(sentenceStart)).toHaveLength(2)
  })
})
