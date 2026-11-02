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
  id: string
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
}

export interface Story {
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
  show: { title: string, url: string, author?: string, copyright?: string } | null
  episodes: PodcastEpisode[]
  status: FeedStatus
}

export type ReactionKey = 'hjarta' | 'eld' | 'stjarna' | 'tarar'

export interface PostAuthor {
  name: string
  handle: string
  /** e.g. "Säsongskort sedan 1998" */
  flair?: string
}

export interface PostComment {
  id: string
  author: PostAuthor
  body: string
  createdAt: string
}

export interface Post {
  id: string
  author: PostAuthor
  body: string
  createdAt: string
  sport?: Sport
  storyId?: string
  reactions: Record<ReactionKey, number>
  comments: PostComment[]
  demo: boolean
}
