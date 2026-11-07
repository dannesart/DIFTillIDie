import type { PodcastEpisode, PodcastResponse } from '#shared/types/domain'

/*
 * Where you were in a podcast, kept in this browser only: the episode (as
 * the show's own feed described it), its show, and the position. A refresh,
 * a browser restart or a new build of the site brings it back, paused: the
 * supporter presses Play to carry on. Starting another episode replaces it,
 * closing the player or finishing the episode forgets it.
 *
 * What's read back is checked before it's used: anything malformed is
 * ignored, and an episode is only offered from a show that's still on the
 * site and whose id it carries. An episode that has since dropped out of
 * the show's latest feed still resumes from what was kept, so an older
 * episode can be finished; the feed's own, fresher copy wins when it's there.
 */

export const SESSION_KEY = 'djurgarn:podcast-session:v1'

/** Less than this in, and it starts from the top anyway. */
export const RESUME_FROM = 5
/** This close to the end (or ended), it's finished: never resumed seconds before the end. */
export const FINISHED_WITHIN = 30

export interface PlaybackSession {
  showId: string
  showTitle: string
  episode: PodcastEpisode
  /** Seconds in. */
  position: number
  /** Seconds, as the audio itself reported (or the feed said). */
  duration?: number
}

export type StoredSession = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const MAX_TEXT = 500
const text = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const seconds = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24 * 3600

/** A web address the audio element (or a link) may use: http(s) only. */
function webUrl(v: unknown): v is string {
  if (!text(v, 2000)) return false
  try { return ['https:', 'http:'].includes(new URL(v).protocol) }
  catch { return false }
}

/** The stored session, or null when there's none or it isn't one we wrote. */
export function readSession(storage: Pick<Storage, 'getItem'> | undefined): PlaybackSession | null {
  let raw: unknown
  try { raw = JSON.parse(storage?.getItem(SESSION_KEY) ?? 'null') }
  catch { return null }
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const ep = (s.episode && typeof s.episode === 'object' ? s.episode : {}) as Record<string, unknown>
  if (!text(s.showId, 100) || !text(s.showTitle) || !seconds(s.position)) return null
  // An episode belongs to the show whose id it starts with (see server/lib/podcast.ts).
  if (!text(ep.id, 1000) || !ep.id.startsWith(`${s.showId}:`)) return null
  if (!text(ep.title) || !webUrl(ep.url) || !webUrl(ep.audioUrl) || !text(ep.publishedAt, 40)) return null
  return {
    showId: s.showId,
    showTitle: s.showTitle,
    episode: {
      id: ep.id,
      title: ep.title,
      url: ep.url,
      audioUrl: ep.audioUrl,
      publishedAt: ep.publishedAt,
      durationSeconds: seconds(ep.durationSeconds) && ep.durationSeconds > 0 ? ep.durationSeconds : undefined,
    },
    position: s.position,
    duration: seconds(s.duration) && s.duration > 0 ? s.duration : undefined,
  }
}

/** Keep only what's needed to play it again (no show notes). */
export function writeSession(storage: StoredSession | undefined, s: PlaybackSession) {
  const { id, title, url, audioUrl, publishedAt, durationSeconds } = s.episode
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify({
      showId: s.showId,
      showTitle: s.showTitle,
      episode: { id, title, url, audioUrl, publishedAt, durationSeconds },
      position: Math.round(s.position * 10) / 10,
      duration: s.duration,
    }))
  }
  catch { /* storage full or blocked: it just won't be remembered */ }
}

export function clearSession(storage: StoredSession | undefined) {
  try { storage?.removeItem(SESSION_KEY) }
  catch { /* blocked */ }
}

/** Played to (nearly) the end. */
export function isFinished(position: number, duration?: number) {
  return !!duration && position >= duration - FINISHED_WITHIN
}

/** Where to pick up: from the top when barely started, or when finished. */
export const resumeAt = (position: number, duration?: number) =>
  position < RESUME_FROM || isFinished(position, duration) ? 0 : position

export type Restore =
  | { action: 'restore', episode: PodcastEpisode, show: { id: string, title: string }, position: number, duration?: number }
  /** Nothing to bring back, ever (finished, or its show is gone): drop it. */
  | { action: 'forget' }
  /** Can't tell right now (no session, or the shows didn't load): leave it be. */
  | { action: 'none' }

/** What a stored session becomes, given the shows on the site right now. */
export function planRestore(session: PlaybackSession | null, shows: PodcastResponse[] | undefined): Restore {
  if (!session) return { action: 'none' }
  if (!shows?.length) return { action: 'none' }
  const show = shows.find(s => s.id === session.showId)
  if (!show) return { action: 'forget' }
  const fresh = show.episodes.find(e => e.id === session.episode.id && e.audioUrl)
  const episode = fresh ?? session.episode
  const duration = session.duration ?? episode.durationSeconds
  if (isFinished(session.position, duration)) return { action: 'forget' }
  return { action: 'restore', episode, show: { id: show.id, title: show.show?.title ?? show.status.outlet ?? session.showTitle }, position: resumeAt(session.position, duration), duration }
}
