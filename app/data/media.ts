/*
 * Podcasts and video channels.
 *
 * The shows are real names supporters know, but we have not yet verified
 * their exact feed/channel IDs, so links go to genuine search pages on each
 * platform. When an `embed` is added (a verified Spotify show/episode or a
 * YouTube video/playlist URL), the card offers a click-to-load player.
 */

export interface MediaLink {
  label: string
  url: string
}

export interface MediaItem {
  id: string
  kind: 'podd' | 'video'
  title: string
  tagline: string
  /** Visual identity for the generated cover — no copyrighted artwork. */
  cover: 'stripes' | 'night' | 'ice' | 'grass'
  links: MediaLink[]
  /** Official embed URL (open.spotify.com/embed/... or youtube-nocookie.com/embed/...). */
  embed?: string
  /** Show this one first at night. */
  nocturnal?: boolean
}

const q = encodeURIComponent

function podLinks(term: string): MediaLink[] {
  return [
    { label: 'Spotify', url: `https://open.spotify.com/search/${q(term)}/podcastAndEpisodes` },
    { label: 'Apple Podcasts', url: `https://podcasts.apple.com/se/search?term=${q(term)}` },
    { label: 'YouTube', url: `https://www.youtube.com/results?search_query=${q(term)}` },
  ]
}

export const media: MediaItem[] = [
  {
    id: 'difpodden',
    kind: 'podd',
    title: 'DIFpodden',
    tagline: 'Snacket om allt som är blårandigt – laget, läktaren och livet runt omkring.',
    cover: 'stripes',
    links: podLinks('DIFpodden'),
  },
  {
    id: 'by-night',
    kind: 'podd',
    title: 'Djurgår’n by Night',
    tagline: 'När lamporna släcks på arenan börjar snacket på riktigt.',
    cover: 'night',
    links: podLinks('Djurgår\'n by Night'),
    nocturnal: true,
  },
  {
    id: 'yt-fotboll',
    kind: 'video',
    title: 'Djurgården Fotboll',
    tagline: 'Höjdpunkter, intervjuer och bakom kulisserna från fotbollen.',
    cover: 'grass',
    links: [{ label: 'Sök på YouTube', url: `https://www.youtube.com/results?search_query=${q('Djurgården Fotboll')}` }],
  },
  {
    id: 'yt-hockey',
    kind: 'video',
    title: 'Djurgården Hockey',
    tagline: 'Mål, räddningar och känslor från isen på Hovet.',
    cover: 'ice',
    links: [{ label: 'Sök på YouTube', url: `https://www.youtube.com/results?search_query=${q('Djurgården Hockey')}` }],
  },
]
