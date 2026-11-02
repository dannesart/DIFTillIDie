import type { FeedStatus, SourceArticle, Sport } from '../../shared/types/domain'
import type { RssChannel, RssItem } from './rss'
import { fetchFeed } from './rss'

export interface NewsSource {
  id: string
  outlet: string
  publisher: string
  homepage: string
  feedUrl: string
  sport: Sport
  /**
   * `team-feed`: every item is already about Djurgården (publisher's own tagging).
   * `broad`: a general sports section — keep only items that clearly mention Djurgården.
   */
  scope: 'team-feed' | 'broad'
  /**
   * `original`: the outlet's own reporting.
   * `compiled`: the outlet summarises other media's reporting, so it is
   * never counted as independent confirmation.
   */
  reporting: SourceArticle['reporting']
}

export const NEWS_SOURCES: NewsSource[] = [
  {
    id: 'bollsvenskan',
    outlet: 'Bollsvenskan',
    publisher: 'Bollsvenskan',
    homepage: 'https://bollsvenskan.se/teams/djurgardens-if/',
    feedUrl: 'https://bollsvenskan.se/feed/djurgardens-if',
    sport: 'fotboll',
    scope: 'team-feed',
    // Its articles end with "Läs hela artiklarna hos …" and a list of
    // the outlets they summarise (checked 2026-11-02). The feed itself
    // doesn't name them, so we label the source rather than guess.
    reporting: 'compiled',
  },
  {
    id: 'sportbladet-fotboll',
    outlet: 'Sportbladet',
    publisher: 'Aftonbladet',
    homepage: 'https://www.aftonbladet.se/sportbladet/fotboll',
    feedUrl: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/',
    sport: 'fotboll',
    scope: 'broad',
    reporting: 'original',
  },
  {
    id: 'sportbladet-hockey',
    outlet: 'Sportbladet',
    publisher: 'Aftonbladet',
    homepage: 'https://www.aftonbladet.se/sportbladet/hockey',
    feedUrl: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/hockey/',
    sport: 'hockey',
    scope: 'broad',
    reporting: 'original',
  },
]

/** Lowercase, strip diacritics. "Djurgårdens" → "djurgardens". */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** The words of an article URL's last path segment: ".../djurgarden-vann-mot-degerfors?x" → "djurgarden vann mot degerfors". */
export function slugWords(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return last.replace(/[-_]+/g, ' ')
  }
  catch {
    return ''
  }
}

// "Djurgården", "Djurgårdens", "Djurgår'n", "DIF" — but not "Djurgårdsbrunn" etc.
const DIF_PATTERN = /\b(djurgard(en|ens)?|djurgar'?n|dif)\b/

/**
 * Is this item from a broad sports feed actually about Djurgården?
 * Conservative: the club must be named in the headline, the publisher's
 * teaser, or the article's URL slug (Sportbladet often names the club only there).
 */
export function mentionsDjurgarden(item: Pick<RssItem, 'title' | 'description' | 'link'>): boolean {
  const haystack = fold(`${item.title} ${item.description ?? ''} ${slugWords(item.link)}`).replace(/[’`]/g, '\'')
  return DIF_PATTERN.test(haystack)
}

function parseDate(s?: string): string | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** URL identity without tracking parameters (but keeping e.g. Bollsvenskan's `?post_id=`). */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_')) u.searchParams.delete(key)
    return u.toString()
  }
  catch {
    return url
  }
}

/**
 * Stable article id: publisher + canonical URL. The same article reached
 * through two feeds (or with new tracking params) keeps the same id.
 */
export function articleId(publisher: string, url: string): string {
  return `${fold(publisher).replace(/[^a-z0-9]+/g, '')}-${hashId(canonicalUrl(url))}`
}

function hashId(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

const EXCERPT_MAX = 220

export function clip(s: string | undefined, max = EXCERPT_MAX): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t
}

export function toSourceArticles(source: NewsSource, channel: RssChannel): { articles: SourceArticle[], itemCount: number } {
  const articles: SourceArticle[] = []
  for (const item of channel.items) {
    if (source.scope === 'broad' && !mentionsDjurgarden(item)) continue
    const publishedAt = parseDate(item.pubDate)
    if (!publishedAt) continue
    articles.push({
      id: articleId(source.publisher, item.link),
      sourceId: source.id,
      outlet: source.outlet,
      publisher: source.publisher,
      headline: item.title,
      excerpt: clip(item.description),
      url: item.link,
      publishedAt,
      sport: source.sport,
      reporting: source.reporting,
    })
  }
  return { articles, itemCount: channel.items.length }
}

export interface SourceResult {
  articles: SourceArticle[]
  status: FeedStatus
}

/**
 * Fetch one source. Never throws: on failure it returns the last good
 * result marked stale, or nothing with the error — never invented content.
 */
export async function loadSource(
  source: NewsSource,
  opts: { lastGood: Map<string, SourceResult>, fetcher?: typeof fetch, timeoutMs?: number },
): Promise<SourceResult> {
  try {
    const channel = await fetchFeed(source.feedUrl, opts)
    const { articles, itemCount } = toSourceArticles(source, channel)
    const result = { articles, status: okStatus(source, itemCount, articles.length, new Date().toISOString()) }
    opts.lastGood.set(source.id, result)
    return result
  }
  catch (e) {
    const previous = opts.lastGood.get(source.id)
    return { articles: previous?.articles ?? [], status: failedStatus(source, (e as Error).message, previous) }
  }
}

export function okStatus(source: NewsSource, itemCount: number, relevantCount: number, fetchedAt: string): FeedStatus {
  return { id: source.id, sport: source.sport, outlet: source.outlet, publisher: source.publisher, homepage: source.homepage, ok: true, stale: false, fetchedAt, itemCount, relevantCount }
}

export function failedStatus(source: NewsSource, error: string, lastGood?: SourceResult): FeedStatus {
  return lastGood
    ? { ...lastGood.status, ok: false, stale: true, error }
    : { id: source.id, sport: source.sport, outlet: source.outlet, publisher: source.publisher, homepage: source.homepage, ok: false, stale: false, fetchedAt: null, itemCount: 0, relevantCount: 0, error }
}
