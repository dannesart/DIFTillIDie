/**
 * The small domain vocabulary of Djurgår'n tills jag dör.
 *
 *  - Story:          an event or subject being covered.
 *  - SourceArticle:  one outlet's own article about a Story. Keeps its own
 *                    headline, URL and attribution — never merged.
 *  - Post:           something a supporter says in Snacket på stan.
 */

export type Sport = 'fotboll' | 'hockey'

export interface SourceArticle {
  /** Publisher + a 96-bit hash of the canonical URL. Stable while the article is in a feed. */
  id: string
  /**
   * The id this article had before (publisher + a 32-bit hash). Posts from
   * that time refer to Stories by it, so Stories still answer to it.
   */
  legacyId?: string
  /** Which configured feed it came from, e.g. "sportbladet-fotboll". */
  sourceId: string
  /** Outlet name as shown to readers, e.g. "Sportbladet". */
  outlet: string
  /** The company publishing it, e.g. "Aftonbladet". */
  publisher: string
  /** The outlet's original headline, unedited. */
  headline: string
  /** The outlet's own teaser from its feed, if any. Never our words. */
  excerpt?: string
  /** Link to the original article. */
  url: string
  publishedAt: string
  sport: Sport
  /**
   * `original`: the outlet's own reporting. `compiled`: a summary of other
   * media's reporting — never counted as independent confirmation.
   */
  reporting: 'original' | 'compiled'
}

export interface Story {
  /**
   * `story-<id of the earliest article>`. It changes if that article
   * leaves every feed, so use storyAnswersTo() to look a Story up.
   */
  id: string
  sport: Sport
  /** Oldest first. */
  sources: SourceArticle[]
  /**
   * The source whose own headline is shown as the Story's headline.
   * We never write our own headline for a Story.
   */
  leadId: string
  /** Names (from the sources' own headlines/teasers) that linked the grouped sources. Empty for single-source Stories. */
  sharedNames: string[]
  updatedAt: string
  /**
   * The Story as this server read it from the feeds, signed so the database
   * can tell it apart from anything a browser made up. Attaching the Story
   * to a post sends this along, and the post keeps it for good. Absent when
   * the server has no signing key: then a Story can't be attached.
   */
  capture?: StoryCapture
}

export interface StoryCapture {
  /** The exact JSON of a FrozenStory that was signed. Sent as-is, never re-serialised. */
  data: string
  /** HMAC-SHA256 of `data`, hex. */
  sig: string
}

/**
 * One source of a Story, as it stood in the publisher's feed when our
 * server read it. Only what's needed to show and find the reference
 * again: no article text.
 */
export interface FrozenSource {
  /** SHA-256 of the canonical URL, hex: the article's durable identity. */
  key: string
  id: string
  legacyId?: string
  sourceId: string
  outlet: string
  publisher: string
  headline: string
  url: string
  publishedAt: string
  /** When our server read this from the publisher's feed. Not necessarily the article's first version. */
  capturedAt: string | null
  reporting: SourceArticle['reporting']
  sport: Sport
}

/** A Story frozen at publication time: exactly the sources the supporter attached. */
export interface FrozenStory {
  v: 1
  /** Which signing key; lets keys rotate. */
  kid: string
  storyId: string
  /** `key` of the source whose headline the Story showed. */
  leadKey: string
  sources: FrozenSource[]
}

export interface FeedStatus {
  id: string
  /** Set for news sources; absent for the podcast. */
  sport?: Sport
  outlet: string
  publisher: string
  homepage: string
  ok: boolean
  /** True when the latest fetch failed and we show the last good result. */
  stale: boolean
  fetchedAt: string | null
  /** Items in the feed / items that are about Djurgården. */
  itemCount: number
  relevantCount: number
  error?: string
}

export interface NewsResponse {
  stories: Story[]
  sources: FeedStatus[]
  generatedAt: string
}

export interface PodcastEpisode {
  id: string
  title: string
  publishedAt: string
  /** The episode's page at the podcast host. */
  url: string
  /** The enclosure the publisher distributes to podcast players. */
  audioUrl?: string
  durationSeconds?: number
  /** First paragraph of the publisher's own episode notes, as plain text. */
  excerpt?: string
}

export interface PodcastResponse {
  /** Stable show id, e.g. "blarandigtsnack". */
  id: string
  show: { title: string, url: string, author?: string, copyright?: string } | null
  episodes: PodcastEpisode[]
  status: FeedStatus
  /** Generated cover art. */
  cover: 'night' | 'snack'
  tagline: string
  hosts?: string
  /** Direct listening links elsewhere — and the fallback if the feed fails. */
  links: { label: string, url: string }[]
  nocturnal: boolean
  newcomer: boolean
}

export interface PodcastsResponse {
  shows: PodcastResponse[]
}

export type ReactionKey = 'hjarta' | 'eld' | 'stjarna' | 'tarar'

/** How a supporter appears on a post: their own chosen name and handle. */
export interface PostAuthor {
  name: string
  handle: string
}

export type FixtureTeam = 'herr' | 'dam'

/** A first-team match, from an official source. */
export interface Fixture {
  id: string
  sport: Sport
  team: FixtureTeam
  /** e.g. "Allsvenskan", "OBOS Damallsvenskan", "SHL". */
  competition: string
  /** Team names in the official order: home first. */
  home: string
  away: string
  venue?: string
  /** UTC instant of kickoff / puck drop. */
  kickoff: string
  /** The club marks the date/time as preliminary. */
  preliminary: boolean
  /** `dif-kalender`: dif.se's calendar, fetched automatically. `manual`: checked and entered by hand. */
  source: 'dif-kalender' | 'manual'
  /** For manual entries: the day it was checked on the official site. */
  verifiedAt?: string
  officialUrl: string
  ticketsUrl?: string
}

export interface TeamScope {
  sport: Sport
  team: FixtureTeam
  label: string
  /** automatic: synced from an official calendar. manual: hand-verified. none: not covered yet. */
  coverage: 'automatic' | 'manual' | 'none'
}

export interface FixturesResponse {
  /** Upcoming only, earliest first. */
  fixtures: Fixture[]
  status: FeedStatus
  scope: TeamScope[]
  generatedAt: string
}
