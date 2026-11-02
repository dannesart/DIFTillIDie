import type { PodcastEpisode, PodcastResponse } from '../../shared/types/domain'
import type { RssChannel } from './rss'
import { fetchFeed } from './rss'
import type { NewsSource } from './news'
import { clip } from './news'

export const PODCAST_SOURCE = {
  id: 'djurgarnbynight',
  outlet: 'Djurgårn by night',
  publisher: 'Splitstone productions AB',
  homepage: 'https://pod.space/djurgarnbynight',
  feedUrl: 'https://feed.pod.space/djurgarnbynight',
} as const satisfies Omit<NewsSource, 'sport' | 'scope'>

export const EPISODE_LIMIT = 8

/** "00:35:30", "35:30" or "2130" → seconds. */
export function parseDuration(s?: string): number | undefined {
  if (!s) return undefined
  const parts = s.split(':').map(Number)
  if (parts.some(n => !Number.isFinite(n))) return undefined
  return parts.reduce((acc, n) => acc * 60 + n, 0) || undefined
}

/** Only https audio from the publisher's own feed is ever handed to the player. */
function audioUrl(url?: string, type?: string): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return undefined
    if (type && !type.startsWith('audio/')) return undefined
    return u.toString()
  }
  catch {
    return undefined
  }
}

/** Fetch the show. Never throws; falls back to the last good result marked stale. */
export async function loadPodcast(opts: { lastGood: { value?: PodcastResponse }, fetcher?: typeof fetch, timeoutMs?: number }): Promise<PodcastResponse> {
  const base = { id: PODCAST_SOURCE.id, outlet: PODCAST_SOURCE.outlet, publisher: PODCAST_SOURCE.publisher, homepage: PODCAST_SOURCE.homepage }
  try {
    const channel = await fetchFeed(PODCAST_SOURCE.feedUrl, opts)
    const { show, episodes } = toEpisodes(channel)
    const result: PodcastResponse = {
      show,
      episodes,
      status: { ...base, ok: true, stale: false, fetchedAt: new Date().toISOString(), itemCount: channel.items.length, relevantCount: episodes.length },
    }
    opts.lastGood.value = result
    return result
  }
  catch (e) {
    const error = (e as Error).message
    const previous = opts.lastGood.value
    if (previous) return { ...previous, status: { ...previous.status, ok: false, stale: true, error } }
    return { show: null, episodes: [], status: { ...base, ok: false, stale: false, fetchedAt: null, itemCount: 0, relevantCount: 0, error } }
  }
}

export function toEpisodes(channel: RssChannel): Pick<PodcastResponse, 'show' | 'episodes'> {
  const episodes: PodcastEpisode[] = channel.items.slice(0, EPISODE_LIMIT).flatMap((item) => {
    const t = Date.parse(item.pubDate ?? '')
    if (!Number.isFinite(t)) return []
    return [{
      id: item.guid || item.link,
      title: item.title,
      publishedAt: new Date(t).toISOString(),
      url: item.link,
      audioUrl: audioUrl(item.enclosure?.url, item.enclosure?.type),
      durationSeconds: parseDuration(item.duration),
      // First paragraph of the show notes only — the rest is links and plugs.
      excerpt: clip(item.description?.split('\n')[0], 180),
    }]
  })
  return {
    show: { title: channel.title || PODCAST_SOURCE.outlet, url: channel.link || PODCAST_SOURCE.homepage, author: channel.author, copyright: channel.copyright },
    episodes,
  }
}
