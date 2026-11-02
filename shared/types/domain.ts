/**
 * The small domain vocabulary of Djurgår'n tills jag dör.
 *
 *  - Story:          an event or subject being covered.
 *  - SourceArticle:  one outlet's own article about a Story. Keeps its own
 *                    headline, URL and attribution — never merged.
 *  - Post:           something a supporter says in Snacket på stan.
 */

export type Sport = 'fotboll' | 'hockey'

/** `klubben` is for things that belong to the whole club, not one section. */
export type StorySport = Sport | 'klubben'

export interface SourceArticle {
  id: string
  /** Outlet name exactly as the source presents itself. */
  outlet: string
  /** The outlet's original headline, unedited. */
  headline: string
  /** Link to the original article. */
  url: string
  publishedAt: string
  format: 'nyhet' | 'krönika' | 'intervju' | 'analys' | 'notis'
  /** True for invented content used while we explore the experience. */
  demo: boolean
}

export interface Story {
  id: string
  sport: StorySport
  /** Short label above the title, e.g. "Derbyt". */
  kicker: string
  /** Our neutral name for the subject — not a claim from any source. */
  title: string
  /** What the Story is about. Never a summary of what sources claim. */
  about: string
  sources: SourceArticle[]
  updatedAt: string
  demo: boolean
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
