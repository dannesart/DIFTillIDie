import { describe, expect, it } from 'vitest'
import type { SourceArticle, Story } from '../shared/types/domain'
import { groupIntoStories } from '../server/lib/grouping'
import { CANDIDATES, canonicalArticles, eventKinds, groupWith, namesInSentences } from '../server/lib/groupingCandidates'
import { canonicalUrl } from '../server/lib/news'
import { fixtureArticles } from './helpers'
import { at, cases, chain, compiled, multiKindBridge, original, reactions, sacking, sentenceStart, single, together, transfer, twoEvents, twoStepBridge, unknownBridge } from './grouping-cases'

/*
 * Candidate grouping algorithms (Issue #25), compared on the regression cases and the committed fixtures.
 * The real-feed snapshots and their labels are third-party text and are not committed: they live in the
 * gitignored .data/grouping-eval/ (capture.ts, labels-*.json, evaluate.ts) on the machine that captured them.
 */

const bridgeCases = [...unknownBridge(), ...multiKindBridge(), ...twoStepBridge(), ...reactions]
const fixtures = fixtureArticles()
const all = () => [...Object.values(cases).flat(), ...fixtures, ...bridgeCases]
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

const isolate = CANDIDATES['cluster veto + isolate + single + 36h']!
const clusterVeto = CANDIDATES['cluster veto + single + 36h']!
const shape = (stories: Story[], arts: SourceArticle[]) => stories
  .filter(s => s.sources.some(a => arts.includes(a)))
  .map(s => s.sources.map(a => 'ABCD'[arts.indexOf(a)]).join(''))
  .sort()

describe('bridges between incompatible events (sacking A, national team C, bridge B)', () => {
  it('pairwise veto (the earlier recommendation) puts A and C in one Story through B', () => {
    const arts = unknownBridge()
    expect(together(group(arts), arts[0]!, arts[2]!)).toBe(true)
    const multi = multiKindBridge()
    expect(together(group(multi), multi[0]!, multi[2]!)).toBe(true)
  })

  it.each([2, 6, 10])('isolation: B of unknown kind at %ih joins neither end', (hours) => {
    const arts = unknownBridge(hours)
    expect(shape(groupWith(arts, isolate), arts)).toEqual(['A', 'B', 'C'])
  })

  it('isolation: B reporting both kinds joins neither end', () => {
    const arts = multiKindBridge()
    expect(shape(groupWith(arts, isolate), arts)).toEqual(['A', 'B', 'C'])
  })

  it('isolation: two unknown articles in a row between A and C both stay apart', () => {
    const arts = twoStepBridge()
    expect(shape(groupWith(arts, isolate), arts)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('cluster veto alone keeps A and C apart, but gives B to the nearer end in time (evidence against it)', () => {
    const near = unknownBridge(2)
    expect(shape(groupWith(near, clusterVeto), near)).toEqual(['AB', 'C'])
    const far = unknownBridge(10)
    expect(shape(groupWith(far, clusterVeto), far)).toEqual(['A', 'BC'])
    // Exactly halfway, position (an index tie-break) decides
    const half = unknownBridge(6)
    expect(shape(groupWith(half, clusterVeto), half)).toEqual(['AB', 'C'])
    for (const arts of [multiKindBridge(), twoStepBridge()]) expect(together(groupWith(arts, clusterVeto), arts[0]!, arts.at(-1)!)).toBe(false)
  })

  it.each([['cluster veto', clusterVeto], ['isolation', isolate]] as const)('%s: the same Stories in any order', (_, c) => {
    for (const arts of [unknownBridge(2), unknownBridge(6), unknownBridge(10), multiKindBridge(), twoStepBridge(), reactions]) {
      const expected = partition(groupWith(arts, c))
      for (let i = 0; i < 30; i++) expect(partition(groupWith(shuffled(arts), c))).toEqual(expected)
    }
  })

  it('isolation keeps one event\'s reactions together when nothing conflicts', () => {
    expect(groupWith(reactions, isolate)).toHaveLength(1)
  })
})

describe('cluster veto + isolation: today\'s guarantees and the Degerfors fixture', () => {
  const g = (arts: SourceArticle[]) => groupWith(arts, isolate)
  it('keeps the guarantees and closes the known gaps', () => {
    expect(g(transfer)).toHaveLength(1)
    expect(g(sacking)).toHaveLength(1)
    expect(together(g(twoEvents), twoEvents[0]!, twoEvents[1]!)).toBe(false)
    expect(together(g(chain), chain[0]!, chain[2]!)).toBe(false)
    expect(g(sentenceStart)).toHaveLength(2)
  })

  it('keeps the four Degerfors match reports together, and the pre-match interview apart', () => {
    const stories = g(fixtureArticles())
    const storyWith = (start: string) => stories.find(s => s.sources.some(a => a.headline.startsWith(start)))!
    expect(storyWith('Rosenqvist första mål').sources).toHaveLength(4)
    expect(storyWith('Honkavaara inför Degerfors').sources).toHaveLength(1)
  })

  it('only ever splits a Story today\'s grouping makes, never joins two', () => {
    for (const articles of [all(), ...Object.values(cases), unknownBridge(), multiKindBridge(), twoStepBridge(), reactions]) {
      const today = groupIntoStories(articles)
      const home = new Map(today.flatMap((s, i) => s.sources.map(a => [a.id, i] as const)))
      for (const s of g(articles)) expect(new Set(s.sources.map(a => home.get(a.id))).size).toBe(1)
    }
  })
})

describe('duplicate canonical URLs: which copy is kept', () => {
  const first = compiled({ headline: 'Lina Berg lämnar Djurgården för Vålerenga', excerpt: 'Övergången är klar.', publishedAt: at(0), sourceId: 'bollsvenskan' })
  const restamped = { ...first, headline: 'Lina Berg klar för Vålerenga', excerpt: 'Uppdaterad.', publishedAt: at(1) }
  const tracked = { ...first, url: `${first.url}?utm_source=x`, headline: 'Berg till Vålerenga', publishedAt: at(2) }
  const kept = (arts: SourceArticle[]) => canonicalArticles(arts).find(a => a.id === first.id)!

  it('keeps the earliest copy, whatever its text and whatever the order', () => {
    for (let i = 0; i < 30; i++) expect(kept(shuffled([first, restamped, tracked]))).toBe(first)
  })

  it('at the same time, keeps the copy from the feed configured first', () => {
    const fotboll = { ...first, sourceId: 'sportbladet-fotboll', headline: 'Från fotbollsflödet' }
    const hockey = { ...first, sourceId: 'sportbladet-hockey', sport: 'hockey' as const, headline: 'Från hockeyflödet' }
    expect(kept([hockey, fotboll])).toBe(fotboll)
    expect(kept([fotboll, hockey])).toBe(fotboll)
  })

  it('with only the text differing, keeps the same copy in any order', () => {
    const edited = { ...first, headline: 'Lina Berg lämnar för Vålerenga (uppdaterad)' }
    expect(kept([first, edited])).toBe(kept([edited, first]))
  })

  it.each(Object.entries(CANDIDATES))('%s: copies that change links give the same Stories in any order', (_, c) => {
    const base = compiled({ headline: 'Lina Berg lämnar Djurgården för Vålerenga', excerpt: 'Övergången är klar.', publishedAt: at(0) })
    const vaguer = { ...base, headline: 'Lina Berg om beskedet', excerpt: 'Lina Berg kommenterar.' }
    const later = { ...vaguer, publishedAt: at(1) }
    const national = original({ headline: 'Lina Berg uttagen till landslaget', excerpt: 'Förbundskaptenen tar ut truppen.', publishedAt: at(6) })
    for (const arts of [[base, vaguer, national], [base, later, national]]) {
      const expected = partition(groupWith(arts, c))
      for (let i = 0; i < 20; i++) expect(partition(groupWith(shuffled(arts), c))).toEqual(expected)
    }
  })
})

describe('event classifier under challenge (headline vocabulary)', () => {
  const kinds = (headline: string) => [...eventKinds(compiled({ headline }))].sort()
  it('reads several kinds in one headline', () => {
    expect(kinds('Sparkade Mäkinen klar för Finland')).toEqual(['exit', 'transfer'])
  })
  it('leaves a reaction without event vocabulary unknown, rather than guessing', () => {
    expect(kinds('Mittfältaren Berglund: ”Det känns tomt i omklädningsrummet”')).toEqual([])
  })
  it('reads one event in different wordings as the same kind', () => {
    expect(kinds('Djurgården bryter med Mäkinen')).toEqual(['exit'])
    expect(kinds('Officiellt: Mäkinen sparkas')).toEqual(['exit'])
  })
  it('different wording: "går skilda vägar" is not read as an exit (unknown, so it can still link)', () => {
    expect(kinds('Djurgården och Mäkinen går skilda vägar')).toEqual([])
  })
  // Known weaknesses: what the classifier should do, marked as failing
  it.fails('ambiguous: "klar för spel" is fitness, not a transfer', () => {
    expect(kinds('Mäkinen klar för spel igen')).not.toContain('transfer')
  })
  it.fails('ambiguous: a player dropped from the line-up is not an exit (real feed: hockey)', () => {
    expect(kinds('Backen Lövgren petad – ”Jag ska jobba mig in i laget igen”')).not.toContain('exit')
  })
  it.fails('ambiguous: "inför" as "introduces" is not a match preview (real feed)', () => {
    expect(kinds('Klubben inför nytt biljettsystem på läktaren')).not.toContain('preview')
  })
  it.fails('background in the headline: the defeat that led to a sacking is not a match result (real feed)', () => {
    expect(kinds('Norrvik sparkar tränaren Ek – helgens förlust blev droppen')).not.toContain('result')
  })
  it.fails('background in the headline: "after the sacking" is not a second sacking report', () => {
    expect(kinds('Efter sparken: Mäkinen aktuell för Finland')).toEqual(['search'])
  })
  it.fails('different wording: a sacking reported as "lämnar" is not split from the sacking reports', () => {
    const arts = [
      compiled({ headline: 'Djurgården sparkar Jani Mäkinen', excerpt: 'Jani Mäkinen fick beskedet.', publishedAt: at(0) }),
      original({ headline: 'Jani Mäkinen lämnar Djurgården', excerpt: 'Jani Mäkinen och klubben går skilda vägar.', publishedAt: at(2) }),
    ]
    expect(groupWith(arts, isolate)).toHaveLength(1)
  })
})
