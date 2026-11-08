import type { PlaybackSession } from './playbackSession'
import { FINISHED_WITHIN, RESUME_FROM } from './playbackSession'

/*
 * Where you are in each podcast episode you've listened to, in this browser
 * only: so going from episode A to B and back to A picks A up where it was,
 * and the episode lists can show what's half-heard and what's done.
 *
 * Separate from the active session (lib/playbackSession), which is only the
 * one episode the mini-player brings back after a refresh. Closing the
 * player forgets that session; this history stays.
 *
 * "Completed" means really listened to the end: reaching (nearly) the end
 * AND having played at least half of it. Jumping to the last minutes of an
 * episode isn't completing it. A completed episode starts from the top
 * when played again, and stays completed.
 */

export const HISTORY_KEY = 'djurgarn:podcast-history:v1'
/** Episodes remembered at most; the least recently played go first. */
export const HISTORY_LIMIT = 100
/** Share of an episode that has to have actually played for reaching the end to count as completing it. */
export const COMPLETE_SHARE = 0.5
/** A step forward in playback longer than this between two time updates is a jump, not listening. */
export const LISTEN_STEP_MAX = 3

export interface HistoryEntry {
  /** Where to pick up, in seconds (0 once completed). */
  position: number
  /** Seconds, as the audio reported it (or the feed said); may be unknown. */
  duration?: number
  /** Seconds actually played (jumps not counted), across visits. */
  listened: number
  completed: boolean
  /** When it was last played (ms since epoch): which episodes to keep. */
  updatedAt: number
}

export type ListeningHistory = Record<string, HistoryEntry>

const seconds = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24 * 3600
/** Episode ids are "<show id>:<guid or link>" (server/lib/podcast.ts). */
const episodeId = (k: string) => k.length <= 1000 && /^[a-z0-9_-]{1,100}:./.test(k)

/** The stored history; anything malformed is dropped, and a blocked or corrupt store starts empty. */
export function readHistory(storage: Pick<Storage, 'getItem'> | undefined): ListeningHistory {
  let raw: unknown
  try { raw = JSON.parse(storage?.getItem(HISTORY_KEY) ?? 'null') }
  catch { return {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ListeningHistory = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!episodeId(id) || !v || typeof v !== 'object') continue
    const e = v as Record<string, unknown>
    if (!seconds(e.position) || typeof e.updatedAt !== 'number' || !Number.isFinite(e.updatedAt)) continue
    const duration = seconds(e.duration) && e.duration > 0 ? e.duration : undefined
    out[id] = {
      position: duration ? Math.min(e.position, duration) : e.position,
      duration,
      listened: seconds(e.listened) ? e.listened : 0,
      completed: e.completed === true,
      updatedAt: e.updatedAt,
    }
  }
  return bound(out)
}

export function writeHistory(storage: Pick<Storage, 'setItem'> | undefined, h: ListeningHistory) {
  try { storage?.setItem(HISTORY_KEY, JSON.stringify(bound(h))) }
  catch { /* storage full or blocked: it's remembered for this visit only */ }
}

/** At most HISTORY_LIMIT episodes, the most recently played. */
export function bound(h: ListeningHistory, limit = HISTORY_LIMIT): ListeningHistory {
  const ids = Object.keys(h)
  if (ids.length <= limit) return h
  const keep = ids.sort((a, b) => h[b]!.updatedAt - h[a]!.updatedAt).slice(0, limit)
  return Object.fromEntries(keep.map(id => [id, h[id]!]))
}

/** How much of a step in playback time counts as listening (0 for a jump, backwards or a pause). */
export const listenedStep = (from: number, to: number) => (to > from && to - from <= LISTEN_STEP_MAX ? to - from : 0)

/**
 * Note where an episode is: its position, newly listened seconds, and
 * whether it reached the end (`ended`, or a position within the last
 * stretch). Reaching the end after playing at least COMPLETE_SHARE of it
 * completes it, and it'll start from the top next time.
 */
export function recordProgress(h: ListeningHistory, id: string, p: { position: number, duration?: number, listened?: number, ended?: boolean, now: number }): ListeningHistory {
  const prev = h[id]
  const duration = p.duration && p.duration > 0 ? p.duration : prev?.duration
  const position = Math.max(0, duration ? Math.min(p.position, duration) : p.position)
  const listened = Math.min((prev?.listened ?? 0) + Math.max(0, p.listened ?? 0), duration ?? Number.POSITIVE_INFINITY)
  const atEnd = !!p.ended || (!!duration && position >= duration - FINISHED_WITHIN)
  const finishedNow = atEnd && !!duration && listened >= COMPLETE_SHARE * duration
  const completed = (prev?.completed ?? false) || finishedNow
  return bound({ ...h, [id]: { position: finishedNow ? 0 : position, duration, listened, completed, updatedAt: p.now } })
}

/** Where to start an episode: its own resume point, or the top (never seconds before the end). */
export function resumePoint(entry: HistoryEntry | undefined): number {
  if (!entry) return 0
  const { position, duration } = entry
  if (position < RESUME_FROM) return 0
  if (duration && position >= duration - FINISHED_WITHIN) return 0
  return position
}

/**
 * Switching from one episode to another: the outgoing episode's position is
 * noted under its own id first, and the incoming episode starts from its own
 * resume point, never from the outgoing one's.
 */
export function switchEpisode(h: ListeningHistory, outgoing: { id: string, position: number, duration?: number, listened?: number } | null, incomingId: string, now: number): { history: ListeningHistory, startAt: number } {
  const history = outgoing && outgoing.id !== incomingId ? recordProgress(h, outgoing.id, { ...outgoing, now }) : h
  return { history, startAt: resumePoint(history[incomingId]) }
}

/** An active session saved before there was a history: it becomes the first entry, so nothing is lost. */
export function seedFromSession(h: ListeningHistory, s: PlaybackSession | null, now: number): ListeningHistory {
  if (!s || h[s.episode.id]) return h
  return recordProgress(h, s.episode.id, { position: s.position, duration: s.duration ?? s.episode.durationSeconds, now })
}

export type EpisodeProgress =
  | { state: 'none' }
  | { state: 'progress', fraction: number, remaining: number | null }
  | { state: 'completed' }

/**
 * What the episode lists show: done, part-heard (how far, and roughly how
 * much is left), or nothing (never played, barely opened, or only jumped to
 * the end). Without a known length there's no bar, only that it's begun.
 */
export function episodeProgress(entry: HistoryEntry | undefined, feedDuration?: number): EpisodeProgress {
  if (!entry) return { state: 'none' }
  if (entry.completed && resumePoint(entry) === 0) return { state: 'completed' }
  const at = resumePoint(entry)
  if (!at) return entry.completed ? { state: 'completed' } : { state: 'none' }
  const duration = entry.duration ?? feedDuration
  if (!duration) return { state: 'progress', fraction: 0, remaining: null }
  return { state: 'progress', fraction: Math.min(1, at / duration), remaining: Math.max(0, duration - at) }
}

/** "12 min kvar", "1 h 5 min kvar", "Påbörjad" or "Lyssnad". */
export function progressLabel(p: EpisodeProgress): string | null {
  if (p.state === 'completed') return 'Lyssnad'
  if (p.state !== 'progress') return null
  if (p.remaining === null) return 'Påbörjad'
  const m = Math.max(1, Math.round(p.remaining / 60))
  return `${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`} kvar`
}
