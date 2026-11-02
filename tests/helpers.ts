import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SourceArticle } from '../shared/types/domain'
import { parseRss } from '../server/lib/rss'
import { NEWS_SOURCES, toSourceArticles } from '../server/lib/news'

/** Trimmed copies of the real feeds, captured 2026-11-02. */
export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}.xml`, import.meta.url)), 'utf8')
}

export function fixtureArticles(): SourceArticle[] {
  return NEWS_SOURCES.flatMap(s => toSourceArticles(s, parseRss(fixture(s.id))).articles)
}

/** A fetch that answers with the given body/status, for failure tests. */
export function fakeFetch(body: string, init: ResponseInit = {}): typeof fetch {
  return async () => new Response(body, init)
}

let n = 0
export function article(over: Partial<SourceArticle> & Pick<SourceArticle, 'headline'>): SourceArticle {
  n++
  return {
    id: `t-${n}`,
    sourceId: 'test',
    outlet: 'Testkällan',
    publisher: 'Test',
    url: `https://example.com/a/${n}`,
    publishedAt: '2026-11-01T12:00:00.000Z',
    sport: 'fotboll',
    reporting: 'original',
    ...over,
  }
}
