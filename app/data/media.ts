/*
 * Video channels, plus DIFpodden's Patreon discovery card.
 *
 * Video: we have not verified the channels' exact IDs, so links go to
 * genuine YouTube searches. When an `embed` is added (a verified YouTube
 * video/playlist URL), the card offers a click-to-load player.
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
  cover: 'stripes' | 'night' | 'snack' | 'ice' | 'grass'
  links: MediaLink[]
  /** Official embed URL (open.spotify.com/embed/... or youtube-nocookie.com/embed/...). */
  embed?: string
  /** Show this one first at night. */
  nocturnal?: boolean
}

const q = encodeURIComponent

export const media: MediaItem[] = [
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

/**
 * DIFpodden lives on Patreon now (the Acast feed stopped in March 2023).
 * Checked 2026-11-02 on patreon.com/cw/difpodden: the campaign has Patreon's
 * public RSS switched on, but its address isn't published anywhere we can
 * verify (Apple Podcasts and Poddtoppen still list only the archived Acast
 * feed), and member episodes belong behind Patreon's paywall. So: a
 * discovery card with honest links — no player, no guessed feed URL.
 * If the podcast shares its public RSS address, it can join PODCAST_SHOWS.
 */
export const difpodden = {
  title: 'DIFpodden',
  verifiedAt: '2026-11-02',
  // Paraphrased from the podcast's own Patreon page and membership tiers.
  pitch: 'Det nuvarande DIFpodden finns på Patreon: rapporter från träningarna, röster från spelare och ledare efter matcherna och exklusiva gästavsnitt.',
  formats: ['InförPodd', 'MatchPodd', 'Panelen', 'Hockeypoddar', 'Kulturtimmen'],
  freeMembership: true,
  patreon: 'https://www.patreon.com/cw/difpodden',
  spotify: { label: 'DIFpodden Patreons på Spotify', url: 'https://open.spotify.com/show/4pelRR0sap5c9Z4gLuIJHJ' },
  archive: { label: 'Arkivet fram till mars 2023', url: 'https://podcasts.apple.com/se/podcast/difpodden/id597559697' },
} as const
