import { describe, expect, it } from 'vitest'
import type { SourceArticle, Story } from '../shared/types/domain'
import { groupIntoStories } from '../server/lib/grouping'
import { CANDIDATES, eventKinds, groupWith, namesInSentences } from '../server/lib/groupingCandidates'
import { canonicalUrl } from '../server/lib/news'
import { fixtureArticles } from './helpers'
import { at, cases, chain, compiled, original, sacking, sentenceStart, single, together, transfer, twoEvents } from './grouping-cases'

/*
 * Candidate grouping algorithms (Issue #25), compared on the regression cases and the committed fixtures.
 * The real-feed snapshot and its pair labels are not committed; the comparison against them is in the issue.
 */

const all = () => [...Object.values(cases).flat(), ...fixtureArticles()]
const partition = (stories: Story[]) => stories.map(s => `${s.id}|${s.leadId}|${s.sources.map(a => a.id).join(',')}`).sort()
let seed = 25
const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
const shuffled = <T>(xs: T[]) => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
const recommended = CANDIDATES['veto + single + 36h']!
const group = (articles: SourceArticle[]) => groupWith(articles, recommended)

describe.each(Object.entries(CANDIDATES))('candidate %s', (_, candidate) => {
  it('makes the same Stories from the same articles in any order', () => {
    const expected = partition(groupWith(all(), candidate))
    for (let i = 0; i < 50; i++) expect(partition(groupWith(shuffled(all()), candidate))).toEqual(expected)
  })

  it('keeps every distinct source article, unchanged, in exactly one Story', () => {
    const kept = groupWith(all(), candidate).flatMap(s => s.sources)
    expect(kept).toHaveLength(new Set(all().map(a => canonicalUrl(a.url))).size)
    expect(new Set(kept.map(a => a.id)).size).toBe(kept.length)
    for (const a of kept) expect(all()).toContainEqual(a)
  })

  it('keeps a single article as its own Story and never mixes sports', () => {
    expect(groupWith(single, candidate)[0]!.sources).toEqual(single)
    for (const s of groupWith(all(), candidate)) expect(new Set(s.sources.map(a => a.sport)).size).toBe(1)
  })
})

describe('event kinds', () => {
  it('reads what a headline reports, in general sports vocabulary', () => {
    expect([...eventKinds(twoEvents[0]!)]).toEqual(['transfer'])
    expect([...eventKinds(twoEvents[1]!)]).toEqual(['national'])
    expect([...eventKinds(sacking[0]!)]).toEqual(['exit'])
    expect([...eventKinds(sacking[1]!)]).toEqual(['exit'])
  })

  it('does not count events a teaser recalls as background', () => {
    const a = compiled({ headline: 'Mäkinen lyfts som kandidat för Finland', excerpt: 'Den sparkade tränaren efter förlusten i helgen.' })
    expect(eventKinds(a).has('exit')).toBe(false)
    expect(eventKinds(a).has('result')).toBe(false)
  })
})

describe('sentence-initial words', () => {
  it('are names only when also written capitalised mid-sentence, or known from the headline', () => {
    expect(namesInSentences('Laget reser i dag. Energi och fokus, säger han.').has('energi')).toBe(false)
    expect(namesInSentences('Han är tillbaka. Werner fick rött, säger Werner själv.').has('werner')).toBe(true)
    expect(namesInSentences('Han är tillbaka. Werner fick rött.', new Set(['werner'])).has('werner')).toBe(true)
    // The text's first word opens it, as headlines and teasers open with their subject
    expect(namesInSentences('Werner utvisad mot Degerfors').has('werner')).toBe(true)
  })
})

describe('recommended candidate: single linkage, 36h span, sentence rule, event-kind veto', () => {
  it('keeps the guarantees of today\'s grouping', () => {
    const [story] = group(transfer)
    expect(story!.sources).toHaveLength(2)
    expect(story!.leadId).toBe(transfer[0]!.id)
    expect(group(sacking)).toHaveLength(1)
    expect(group([chain[0]!, chain[2]!])).toHaveLength(2)
  })

  it('closes the four known gaps', () => {
    expect(together(group(twoEvents), twoEvents[0]!, twoEvents[1]!)).toBe(false)
    expect(together(group(chain), chain[0]!, chain[2]!)).toBe(false)
    expect(group(sentenceStart)).toHaveLength(2)
  })

  it('keeps the four Degerfors match reports together, and the pre-match interview apart', () => {
    const stories = group(fixtureArticles())
    const storyWith = (start: string) => stories.find(s => s.sources.some(a => a.headline.startsWith(start)))!
    expect(storyWith('Rosenqvist första mål').sources).toHaveLength(4)
    expect(storyWith('Rosenqvist första mål').leadId).toBe(storyWith('Rosenqvist första mål').sources[0]!.id)
    expect(storyWith('Honkavaara inför Degerfors').sources).toHaveLength(1)
  })

  it('only ever splits a Story today\'s grouping makes, never joins two', () => {
    for (const articles of [all(), ...Object.values(cases)]) {
      const today = groupIntoStories(articles)
      const home = new Map(today.flatMap((s, i) => s.sources.map(a => [a.id, i] as const)))
      for (const s of group(articles)) expect(new Set(s.sources.map(a => home.get(a.id))).size).toBe(1)
    }
  })

  it('still links one person\'s one event across outlets when kinds agree or are unknown', () => {
    const quotes = [
      original({ headline: 'Mäkinen om tiden i Djurgården', excerpt: 'Jani Mäkinen ser tillbaka.', publishedAt: at(0) }),
      compiled({ headline: 'Mäkinen: ”Jag ångrar ingenting”', excerpt: 'Jani Mäkinen i en intervju.', publishedAt: at(2) }),
    ]
    expect(group(quotes)).toHaveLength(1)
  })
})

describe('majority linkage (rejected candidate): the evidence', () => {
  it('splits the Degerfors lead from its own match: it links directly to only one of the three other reports', () => {
    const stories = groupWith(fixtureArticles(), CANDIDATES['majority + 36h']!)
    const lead = stories.find(s => s.sources.some(a => a.headline.startsWith('Rosenqvist första mål')))!
    expect(lead.sources).toHaveLength(1)
  })

  it('does not tell one person\'s two events apart', () => {
    const stories = groupWith(twoEvents, CANDIDATES['majority + 36h']!)
    expect(together(stories, twoEvents[0]!, twoEvents[1]!)).toBe(true)
  })
})
