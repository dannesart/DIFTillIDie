import { describe, expect, it } from 'vitest'
import { groupIntoStories, namesIn } from '../server/lib/grouping'
import { canonicalUrl } from '../server/lib/news'
import { article, fixtureArticles } from './helpers'

describe('groupIntoStories on real feed data', () => {
  const stories = groupIntoStories(fixtureArticles())
  const storyWith = (headlineStart: string) => stories.find(s => s.sources.some(a => a.headline.startsWith(headlineStart)))!

  it('groups the four reports of the Djurgården–Degerfors match from two outlets', () => {
    const match = storyWith('Rosenqvist första mål')
    expect(match.sources.map(a => a.headline)).toEqual([
      'Rosenqvist första mål räddade Djurgården',
      'Patrik Werner fick rött kort efter Degerfors förlust',
      'Djurgården höll undan och vann mot Degerfors: Rosenqvists första mål – rött kort på Werner efter frisparksbråk',
      'VAR-krav efter Djurgården–Degerfors – sportchef Werner utvisad efter nekad frispark',
    ])
    expect(new Set(match.sources.map(a => a.outlet))).toEqual(new Set(['Sportbladet', 'Bollsvenskan']))
    expect(match.sharedNames).toEqual(expect.arrayContaining(['Degerfors', 'Rosenqvist', 'Patrik Werner']))
  })

  it('leads with the earliest source\'s own headline, unchanged', () => {
    const match = storyWith('Rosenqvist första mål')
    const lead = match.sources.find(a => a.id === match.leadId)!
    expect(lead.headline).toBe('Rosenqvist första mål räddade Djurgården')
    expect(lead.outlet).toBe('Sportbladet')
  })

  it('keeps the pre-match interview separate, though it also mentions Degerfors', () => {
    expect(storyWith('Honkavaara inför Degerfors').sources).toHaveLength(1)
  })

  it('keeps the award story from the same evening separate', () => {
    expect(storyWith('Alexander Andersson får').sources).toHaveLength(1)
  })

  it('keeps articles that share only one name separate (Fallenius, Hegland)', () => {
    expect(storyWith('Fallenius häcklades').sources).toHaveLength(1)
    expect(storyWith('Ståhl fördömer').sources).toHaveLength(1)
    expect(storyWith('Uppgifter: Arsenal följer Bo Hegland').sources).toHaveLength(1)
  })

  it('never mixes football and hockey', () => {
    for (const s of stories) expect(new Set(s.sources.map(a => a.sport)).size).toBe(1)
    expect(storyWith('Djurgården skrämde bort Globenspöket').sport).toBe('hockey')
  })

  it('does not lose any article', () => {
    expect(stories.flatMap(s => s.sources)).toHaveLength(fixtureArticles().length)
  })

  it('does not collapse Bollsvenskan articles that differ only by ?post_id=', () => {
    expect(stories.filter(s => s.sources.some(a => a.outlet === 'Bollsvenskan')).flatMap(s => s.sources.filter(a => a.outlet === 'Bollsvenskan'))).toHaveLength(8)
  })
})

describe('groupIntoStories rules', () => {
  it('requires two shared names', () => {
    const stories = groupIntoStories([
      article({ headline: 'Werner rasade efter matchen' }),
      article({ headline: 'Werner om framtiden', publishedAt: '2026-11-01T13:00:00.000Z' }),
    ])
    expect(stories).toHaveLength(2)
  })

  it('links two articles sharing two names, one of them in both headlines', () => {
    const stories = groupIntoStories([
      article({ headline: 'Werner utvisad mot Degerfors' }),
      article({ headline: 'Rött kort för Werner', excerpt: 'Degerfors sportchef fick rött', publishedAt: '2026-11-01T15:00:00.000Z' }),
    ])
    expect(stories).toHaveLength(1)
  })

  it('does not link when the shared names only appear in teasers', () => {
    const stories = groupIntoStories([
      article({ headline: 'Tung kväll i Värmland', excerpt: 'Werner och Degerfors' }),
      article({ headline: 'Domarfrågan igen', excerpt: 'Werner, Degerfors', publishedAt: '2026-11-01T13:00:00.000Z' }),
    ])
    expect(stories).toHaveLength(2)
  })

  it('does not link articles more than 24 hours apart', () => {
    const stories = groupIntoStories([
      article({ headline: 'Werner utvisad mot Degerfors', publishedAt: '2026-11-01T12:00:00.000Z' }),
      article({ headline: 'Werner utvisad mot Degerfors igen', publishedAt: '2026-11-02T13:00:00.000Z' }),
    ])
    expect(stories).toHaveLength(2)
  })

  it('does not link across sports', () => {
    const stories = groupIntoStories([
      article({ headline: 'Djurgården mot Färjestad: Andersson och Karlsson', sport: 'hockey' }),
      article({ headline: 'Andersson och Karlsson inför Färjestad', sport: 'fotboll' }),
    ])
    expect(stories).toHaveLength(2)
  })

  it('treats the same article in two feeds (only utm differs) as one source', () => {
    const stories = groupIntoStories([
      article({ headline: 'Samma artikel', url: 'https://www.aftonbladet.se/a/x?utm_medium=rss' }),
      article({ headline: 'Samma artikel', url: 'https://www.aftonbladet.se/a/x?utm_medium=rss&utm_source=hockey' }),
    ])
    expect(stories).toHaveLength(1)
    expect(stories[0]!.sources).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('finds names but not generic words, our own club or ALL-CAPS bylines', () => {
    expect([...namesIn('WAGNER: Djurgården höll undan mot Degerfors – Rosenqvists första mål')].sort()).toEqual(['degerfor', 'rosenqvist'])
  })

  it('canonicalUrl strips only tracking parameters', () => {
    expect(canonicalUrl('https://bollsvenskan.se/nyhetsflode/?post_id=1&utm_medium=rss')).toBe('https://bollsvenskan.se/nyhetsflode/?post_id=1')
  })
})
