import { describe, expect, it } from 'vitest'
import { groupIntoStories } from '../server/lib/grouping'
import { articleId } from '../server/lib/news'
import { reportingCounts, storyAnswersTo } from '../shared/utils/story'
import { article, fixtureArticles } from './helpers'

describe('article ids', () => {
  it('ignore tracking parameters and which feed an article came through', () => {
    const a = articleId('Aftonbladet', 'https://www.aftonbladet.se/sportbladet/fotboll/a/eGj2Rg/x?utm_medium=rss')
    expect(articleId('Aftonbladet', 'https://www.aftonbladet.se/sportbladet/fotboll/a/eGj2Rg/x')).toBe(a)
    expect(articleId('Aftonbladet', 'https://www.aftonbladet.se/sportbladet/fotboll/a/eGj2Rg/x?utm_medium=rss&utm_source=hockey')).toBe(a)
    expect(a).toMatch(/^aftonbladet-/)
  })

  it('keep Bollsvenskan posts apart (they differ only by ?post_id=)', () => {
    expect(articleId('Bollsvenskan', 'https://bollsvenskan.se/nyhetsflode/?post_id=1')).not.toBe(articleId('Bollsvenskan', 'https://bollsvenskan.se/nyhetsflode/?post_id=2'))
  })
})

describe('compiled reporting (Bollsvenskan)', () => {
  const stories = groupIntoStories(fixtureArticles())
  const match = stories.find(s => s.sources.some(a => a.headline.startsWith('Rosenqvist första mål')))!

  it('marks Bollsvenskan as compiled and Sportbladet as original', () => {
    expect(new Set(match.sources.filter(s => s.outlet === 'Bollsvenskan').map(s => s.reporting))).toEqual(new Set(['compiled']))
    expect(new Set(match.sources.filter(s => s.outlet === 'Sportbladet').map(s => s.reporting))).toEqual(new Set(['original']))
  })

  it('does not count compilations as independent reporting', () => {
    expect(reportingCounts(match)).toEqual({ original: 2, compiled: 2, originalOutlets: ['Sportbladet'] })
  })

  it('leads with original reporting even when a compilation came first', () => {
    const [story] = groupIntoStories([
      article({ headline: 'Werner utvisad mot Degerfors', reporting: 'compiled', publishedAt: '2026-11-01T12:00:00.000Z' }),
      article({ headline: 'Rött kort för Werner efter Degerfors förlust', publishedAt: '2026-11-01T13:00:00.000Z' }),
    ])
    const lead = story!.sources.find(s => s.id === story!.leadId)!
    expect(lead.reporting).toBe('original')
    // ...but the id still comes from the earliest article, not from the lead.
    expect(story!.id).toBe(`story-${story!.sources[0]!.id}`)
    expect(story!.sources[0]!.reporting).toBe('compiled')
  })

  it('still leads with a compilation when it is all there is', () => {
    const [story] = groupIntoStories([article({ headline: 'Tibbling öppnar för återkomst', reporting: 'compiled' })])
    expect(story!.leadId).toBe(story!.sources[0]!.id)
  })
})

describe('story id stability', () => {
  const a = article({ headline: 'Werner rött kort mot Degerfors', publishedAt: '2026-11-01T12:00:00.000Z' })
  const b = article({ headline: 'Werner och Rosenqvist i fokus efter Degerfors', excerpt: 'Skuseth fälldes', publishedAt: '2026-11-01T14:00:00.000Z' })
  const c = article({ headline: 'Rosenqvist om målet – Skuseth om frisparken', publishedAt: '2026-11-01T16:00:00.000Z' })

  it('keeps the id when a newer article joins the Story', () => {
    const before = groupIntoStories([a])[0]!
    const after = groupIntoStories([a, b])
    expect(after).toHaveLength(1)
    expect(after[0]!.id).toBe(before.id)
  })

  it('keeps the id when a newer original report takes over the lead', () => {
    const compiledFirst = { ...a, reporting: 'compiled' as const }
    const before = groupIntoStories([compiledFirst])[0]!
    const after = groupIntoStories([compiledFirst, b])[0]!
    expect(after.leadId).toBe(b.id)
    expect(after.id).toBe(before.id)
  })

  it('still finds both earlier Stories after a bridging article merges them', () => {
    const separate = groupIntoStories([a, c])
    expect(separate).toHaveLength(2)
    const merged = groupIntoStories([a, b, c])
    expect(merged).toHaveLength(1)
    for (const old of separate) expect(storyAnswersTo(merged[0]!, old.id)).toBe(true)
  })

  it('loses a reference once its article has left every feed (known limitation)', () => {
    const before = groupIntoStories([a, b])[0]!
    const after = groupIntoStories([b])[0]!
    expect(after.id).not.toBe(before.id)
    expect(storyAnswersTo(after, before.id)).toBe(false)
    // A reference to an article that is still around keeps working:
    expect(storyAnswersTo(after, `story-${b.id}`)).toBe(true)
  })

  it('splits again when the bridging article leaves, and each part keeps its own id', () => {
    const merged = groupIntoStories([a, b, c])[0]!
    const split = groupIntoStories([a, c])
    expect(split.find(s => storyAnswersTo(s, merged.id))!.sources.map(s => s.id)).toEqual([a.id])
    expect(split.find(s => storyAnswersTo(s, `story-${c.id}`))!.sources.map(s => s.id)).toEqual([c.id])
  })
})
