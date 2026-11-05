import type { NewsResponse, PodcastResponse, PodcastsResponse } from '#shared/types/domain'
import type { NewsSource, SourceResult } from '../lib/news'
import { NEWS_SOURCES, loadSource } from '../lib/news'
import { groupIntoStories } from '../lib/grouping'
import { captureKeyFrom, withCaptures } from '../lib/capture'
import type { PodcastShowConfig } from '../lib/podcast'
import { loadPodcast, loadPodcasts } from '../lib/podcast'
import type { FixturesState } from '../lib/fixtures'
import { loadFixtures } from '../lib/fixtures'

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
const lastGoodPodcasts = new Map<string, PodcastResponse>()

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
  const sources = results.map(r => r.status)
  // Signed per response, so a CDN-cached /api/news still carries valid
  // captures: there's no background job that has to have run.
  const key = captureKeyFrom(useRuntimeConfig().storyCapture)
  return {
    stories: withCaptures(groupIntoStories(results.flatMap(r => r.articles)), key, sources),
    sources,
    generatedAt: new Date().toISOString(),
  }
}

// One cache entry per show, so one slow or failing feed never holds up the other.
const cachedShow = defineCachedFunction(
  async (show: PodcastShowConfig) => {
    const result = await loadPodcast(show, { lastGood: lastGoodPodcasts })
    if (!result.status.ok) console.warn(`[feeds] podcast ${show.id}: ${result.status.error}`)
    return result
  },
  {
    name: 'podcast',
    maxAge: FEED_MAX_AGE,
    swr: true,
    getKey: (show: PodcastShowConfig) => show.id,
    validate: entry => entry.value?.status.ok === true,
  },
)

export function getPodcasts(): Promise<PodcastsResponse> {
  return loadPodcasts({ lastGood: lastGoodPodcasts }, show => cachedShow(show))
}

const lastGoodFixtures: FixturesState = {}

// dif.se itself says max-age=14400 (4 h); 30 min keeps changed kickoffs fresh enough.
export const getFixtures = defineCachedFunction(
  async () => {
    const result = await loadFixtures({ lastGood: lastGoodFixtures })
    if (!result.status.ok) console.warn(`[feeds] fixtures: ${result.status.error}`)
    return result
  },
  {
    name: 'fixtures',
    maxAge: 30 * 60,
    swr: true,
    getKey: () => 'dif',
    validate: entry => entry.value?.status.ok === true,
  },
)
