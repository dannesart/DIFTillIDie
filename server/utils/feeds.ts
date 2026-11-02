import type { NewsResponse, PodcastResponse } from '#shared/types/domain'
import type { NewsSource, SourceResult } from '../lib/news'
import { NEWS_SOURCES, loadSource } from '../lib/news'
import { groupIntoStories } from '../lib/grouping'
import { loadPodcast } from '../lib/podcast'

/*
 * Caching, in two layers and without a database:
 *  - Nitro's cached functions keep each feed for FEED_MAX_AGE seconds per
 *    server instance, so publishers are not hit on every visit. Failures
 *    are never cached; the next request retries.
 *  - The last successful result per feed is kept in memory and served as
 *    "stale" if a later fetch fails or times out.
 * On Netlify, the `isr` route rules in nuxt.config.ts add CDN caching on top.
 */

const FEED_MAX_AGE = 10 * 60
const lastGood = new Map<string, SourceResult>()
const lastGoodPodcast: { value?: PodcastResponse } = {}

const cachedSource = defineCachedFunction(
  async (source: NewsSource) => {
    const result = await loadSource(source, { lastGood })
    if (!result.status.ok) console.warn(`[feeds] ${source.id}: ${result.status.error}${result.status.stale ? ' (serving last good result)' : ''}`)
    return result
  },
  {
    name: 'news-source',
    maxAge: FEED_MAX_AGE,
    swr: true,
    getKey: (source: NewsSource) => source.id,
    validate: entry => entry.value?.status.ok === true,
  },
)

export async function getNews(): Promise<NewsResponse> {
  const results = await Promise.all(NEWS_SOURCES.map(s => cachedSource(s)))
  return {
    stories: groupIntoStories(results.flatMap(r => r.articles)),
    sources: results.map(r => r.status),
    generatedAt: new Date().toISOString(),
  }
}

export const getPodcast = defineCachedFunction(
  async () => {
    const result = await loadPodcast({ lastGood: lastGoodPodcast })
    if (!result.status.ok) console.warn(`[feeds] podcast: ${result.status.error}`)
    return result
  },
  {
    name: 'podcast',
    maxAge: FEED_MAX_AGE,
    swr: true,
    getKey: () => 'djurgarnbynight',
    validate: entry => entry.value?.status.ok === true,
  },
)
