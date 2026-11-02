import { describe, expect, it } from 'vitest'
import type { SourceResult } from '../server/lib/news'
import { NEWS_SOURCES, loadSource, mentionsDjurgarden, toSourceArticles } from '../server/lib/news'
import { parseRss } from '../server/lib/rss'
import { fakeFetch, fixture } from './helpers'

const source = (id: string) => NEWS_SOURCES.find(s => s.id === id)!

describe('mentionsDjurgarden', () => {
  const item = (title: string, link = 'https://x.test/a/1/abc', description = '') => ({ title, link, description })

  it('finds the club in the headline, teaser or URL slug', () => {
    expect(mentionsDjurgarden(item('Rosenqvist första mål räddade Djurgården'))).toBe(true)
    expect(mentionsDjurgarden(item('Stort lyft för DIF'))).toBe(true)
    expect(mentionsDjurgarden(item('Talar ut', undefined, 'Djurgårdens mittfältare'))).toBe(true)
    expect(mentionsDjurgarden(item('Snacket om Djurgår’n'))).toBe(true)
    // Sportbladet often names the club only in the slug:
    expect(mentionsDjurgarden(item(
      'Fallenius häcklades av egna supportrarna',
      'https://www.aftonbladet.se/sportbladet/fotboll/a/mKk6XE/oskar-fallenius-trakasserad-av-djurgardens-supportrar?utm_medium=rss',
    ))).toBe(true)
  })

  it('ignores unrelated items and look-alike words', () => {
    expect(mentionsDjurgarden(item('AIK krossades i skrällförlusten', 'https://x.test/a/1/aik-nollades-i-forlusten-mot-almtuna'))).toBe(false)
    expect(mentionsDjurgarden(item('Konsert vid Djurgårdsbrunn'))).toBe(false)
    expect(mentionsDjurgarden(item('Ny diffus regel'))).toBe(false)
  })
})

describe('toSourceArticles', () => {
  it('keeps only the Djurgården items from the broad Sportbladet football feed', () => {
    const { articles, itemCount } = toSourceArticles(source('sportbladet-fotboll'), parseRss(fixture('sportbladet-fotboll')))
    expect(itemCount).toBe(8)
    expect(articles.map(a => a.headline).sort()).toEqual([
      'Fallenius häcklades av egna supportrarna',
      'Patrik Werner fick rött kort efter Degerfors förlust',
      'Rosenqvist första mål räddade Djurgården',
    ])
  })

  it('keeps only the Djurgården item from the hockey feed', () => {
    const { articles } = toSourceArticles(source('sportbladet-hockey'), parseRss(fixture('sportbladet-hockey')))
    expect(articles.map(a => a.headline)).toEqual(['Djurgården skrämde bort Globenspöket'])
    expect(articles[0]!.sport).toBe('hockey')
  })

  it('keeps every item of the Bollsvenskan team feed', () => {
    expect(toSourceArticles(source('bollsvenskan'), parseRss(fixture('bollsvenskan'))).articles).toHaveLength(8)
  })

  it('preserves publisher, original headline, URL and date', () => {
    const { articles } = toSourceArticles(source('sportbladet-fotboll'), parseRss(fixture('sportbladet-fotboll')))
    const a = articles.find(x => x.headline.startsWith('Rosenqvist'))!
    expect(a).toMatchObject({
      outlet: 'Sportbladet',
      publisher: 'Aftonbladet',
      headline: 'Rosenqvist första mål räddade Djurgården',
      excerpt: '”Vilken jävla känsla”',
      url: 'https://www.aftonbladet.se/sportbladet/fotboll/a/eGj2Rg/djurgarden-vann-mot-degerfors-i-allsvenskan?utm_medium=rss',
      publishedAt: '2026-11-01T14:52:21.000Z',
    })
  })
})

describe('loadSource', () => {
  const bollsvenskan = source('bollsvenskan')

  it('returns articles and an ok status', async () => {
    const r = await loadSource(bollsvenskan, { lastGood: new Map(), fetcher: fakeFetch(fixture('bollsvenskan')) })
    expect(r.status).toMatchObject({ ok: true, stale: false, itemCount: 8, relevantCount: 8 })
    expect(r.articles).toHaveLength(8)
  })

  it('returns nothing (not invented content) when a source fails with no history', async () => {
    const r = await loadSource(bollsvenskan, { lastGood: new Map(), fetcher: fakeFetch('', { status: 500 }) })
    expect(r.articles).toEqual([])
    expect(r.status).toMatchObject({ ok: false, stale: false, fetchedAt: null, error: 'HTTP 500' })
  })

  it('serves the last good result, marked stale, when a later fetch fails', async () => {
    const lastGood = new Map<string, SourceResult>()
    const first = await loadSource(bollsvenskan, { lastGood, fetcher: fakeFetch(fixture('bollsvenskan')) })
    const second = await loadSource(bollsvenskan, { lastGood, fetcher: fakeFetch('<html>down</html>') })
    expect(second.articles).toEqual(first.articles)
    expect(second.status).toMatchObject({ ok: false, stale: true, fetchedAt: first.status.fetchedAt })
    expect(second.status.error).toMatch(/inte ett RSS-flöde/)
  })

  it('handles an empty feed', async () => {
    const r = await loadSource(bollsvenskan, { lastGood: new Map(), fetcher: fakeFetch('<rss version="2.0"><channel><title>x</title></channel></rss>') })
    expect(r.status).toMatchObject({ ok: true, itemCount: 0, relevantCount: 0 })
    expect(r.articles).toEqual([])
  })
})
