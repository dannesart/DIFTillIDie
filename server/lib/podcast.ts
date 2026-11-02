import type { PodcastEpisode, PodcastResponse, PodcastsResponse } from '../../shared/types/domain'
import type { RssChannel } from './rss'
import { fetchFeed } from './rss'
import { clip } from './news'

/*
 * The podcasts that live in "Lyssna & titta". Each has its own public RSS
 * feed; audio streams from the enclosures the publishers distribute to
 * podcast players. Not a media platform — just a short, hand-picked list.
 */

export interface PodcastShowConfig {
  id: string
  /** Fallback title if the feed can't be reached. */
  title: string
  publisher: string
  hosts?: string
  /** The show's own page — where attribution links go. */
  homepage: string
  feedUrl: string
  /** Generated cover art (no copied artwork). */
  cover: PodcastResponse['cover']
  tagline: string
  /** Direct listening links, also the fallback if the feed fails. */
  links: { label: string, url: string }[]
  /** Featured after dark. */
  nocturnal?: boolean
  /** Recently added at a supporter's request: a little welcome badge. */
  newcomer?: boolean
}

const q = encodeURIComponent

export const PODCAST_SHOWS: PodcastShowConfig[] = [
  {
    id: 'djurgarnbynight',
    title: 'Djurgårn by night',
    publisher: 'Splitstone productions AB',
    homepage: 'https://pod.space/djurgarnbynight',
    feedUrl: 'https://feed.pod.space/djurgarnbynight',
    cover: 'night',
    tagline: 'Ramsan som blev en livsstil som behövde en podcast.',
    links: [
      { label: 'pod.space', url: 'https://pod.space/djurgarnbynight' },
      { label: 'Sök på Spotify', url: `https://open.spotify.com/search/${q('Djurgårn by night')}/podcastAndEpisodes` },
    ],
    nocturnal: true,
  },
  {
    id: 'blarandigtsnack',
    title: 'Blårandigt Snack',
    publisher: 'Blårandigt Snack',
    hosts: 'Cosmos & Victor',
    homepage: 'https://shows.acast.com/blarandigt-sn',
    feedUrl: 'https://feeds.acast.com/public/shows/68d05bae2cf15c8db006caa8',
    cover: 'snack',
    tagline: 'Djurgården och Allsvenskan med blårandiga hjärtan.',
    links: [
      { label: 'Spotify', url: 'https://open.spotify.com/show/3XyDBlO7iMHrkXPemp4GWc' },
      { label: 'Poddtoppen', url: 'https://poddtoppen.se/podcast/1845931235/blarandigt-snack' },
      { label: 'Acast', url: 'https://shows.acast.com/blarandigt-sn' },
    ],
    newcomer: true,
  },
]

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

// Hosting-platform boilerplate at the end of show notes ("Hosted on Acast. See acast.com/privacy …").
const BOILERPLATE = /\s*Hosted on Acast\.[\s\S]*$/i

function showMeta(show: PodcastShowConfig) {
  return { id: show.id, cover: show.cover, tagline: show.tagline, hosts: show.hosts, links: show.links, nocturnal: !!show.nocturnal, newcomer: !!show.newcomer }
}

export function toEpisodes(channel: RssChannel, show: PodcastShowConfig): Pick<PodcastResponse, 'show' | 'episodes'> {
  const episodes: PodcastEpisode[] = channel.items.slice(0, EPISODE_LIMIT).flatMap((item) => {
    const t = Date.parse(item.pubDate ?? '')
    if (!Number.isFinite(t)) return []
    return [{
      // Prefixed: episodes from different shows can never be mistaken for each other.
      id: `${show.id}:${item.guid || item.link}`,
      title: item.title,
      publishedAt: new Date(t).toISOString(),
      url: item.link,
      audioUrl: audioUrl(item.enclosure?.url, item.enclosure?.type),
      durationSeconds: parseDuration(item.duration),
      // First paragraph of the show notes only — the rest is links and plugs.
      excerpt: clip(item.description?.split('\n')[0]?.replace(BOILERPLATE, ''), 180),
    }]
  })
  return {
    // The show's own page, not the feed URL some hosts put in <link>.
    show: { title: channel.title || show.title, url: show.homepage, author: channel.author, copyright: channel.copyright },
    episodes,
  }
}

/** Fetch one show. Never throws; falls back to the last good result marked stale. */
export async function loadPodcast(
  show: PodcastShowConfig,
  opts: { lastGood: Map<string, PodcastResponse>, fetcher?: typeof fetch, timeoutMs?: number },
): Promise<PodcastResponse> {
  const base = { id: show.id, outlet: show.title, publisher: show.publisher, homepage: show.homepage }
  try {
    const channel = await fetchFeed(show.feedUrl, opts)
    const { show: info, episodes } = toEpisodes(channel, show)
    const result: PodcastResponse = {
      ...showMeta(show),
      show: info,
      episodes,
      status: { ...base, ok: true, stale: false, fetchedAt: new Date().toISOString(), itemCount: channel.items.length, relevantCount: episodes.length },
    }
    opts.lastGood.set(show.id, result)
    return result
  }
  catch (e) {
    const error = (e as Error).message
    const previous = opts.lastGood.get(show.id)
    if (previous) return { ...previous, status: { ...previous.status, ok: false, stale: true, error } }
    return {
      ...showMeta(show),
      show: { title: show.title, url: show.homepage, author: show.hosts },
      episodes: [],
      status: { ...base, ok: false, stale: false, fetchedAt: null, itemCount: 0, relevantCount: 0, error },
    }
  }
}

/** All shows, each fetched independently — one failing feed never hides the other. */
export async function loadPodcasts(
  opts: { lastGood: Map<string, PodcastResponse>, fetcher?: typeof fetch, timeoutMs?: number },
  load: (show: PodcastShowConfig) => Promise<PodcastResponse> = show => loadPodcast(show, opts),
): Promise<PodcastsResponse> {
  return { shows: await Promise.all(PODCAST_SHOWS.map(load)) }
}
