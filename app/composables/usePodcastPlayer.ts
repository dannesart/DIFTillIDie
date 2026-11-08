import type { PodcastEpisode, PodcastResponse } from '#shared/types/domain'
import type { StoredSession } from '~/lib/playbackSession'
import { clearSession, planRestore, readSession, writeSession } from '~/lib/playbackSession'
import type { EpisodeProgress, ListeningHistory } from '~/lib/listeningHistory'
import { episodeProgress, listenedStep, readHistory, recordProgress, seedFromSession, switchEpisode, writeHistory } from '~/lib/listeningHistory'

/*
 * One player, many controls, any show. The single <audio> element lives in
 * PodcastAudio (mounted once for the whole page) and registers itself here;
 * the show cards and the mini-player all read and drive the same state, so
 * only one stream can ever play. Playback only starts from a click.
 *
 * Where you were is remembered in this browser (lib/playbackSession): saved
 * every few seconds while playing, and on pause, seek and leaving the page.
 * The next visit brings the episode back paused at that point (restore);
 * Play carries on from there.
 *
 * Each episode's own progress is kept too (lib/listeningHistory): starting
 * another episode first notes where the outgoing one was, under its own id,
 * then starts the new one from its own point. The lists show what's
 * part-heard and what's done. Closing the player keeps that history.
 */

export interface PlayingShow {
  id: string
  title: string
}

// The element itself is browser-only, so it lives outside useState.
let audioEl: HTMLAudioElement | null = null
/**
 * Where to start once the audio can seek: a restored position (or a seek made
 * before anything loaded). The element can't seek until its metadata is in,
 * and with preload="none" that's only once Play is pressed.
 */
let pendingSeek: number | null = null
/** Seconds actually played since the current episode's progress was last noted (jumps don't count). */
let pendingListen = 0
let listenFrom: number | null = null
let lastSave = 0
const SAVE_EVERY_MS = 5000

/** This browser's storage, if it may be used at all (it can be blocked). */
function storage(): StoredSession | undefined {
  try { return window.localStorage }
  catch { return undefined }
}

export function usePodcastPlayer() {
  const current = useState<PodcastEpisode | null>('player-current', () => null)
  const currentShow = useState<PlayingShow | null>('player-show', () => null)
  const playing = useState('player-playing', () => false)
  const position = useState('player-position', () => 0)
  const duration = useState('player-duration', () => 0)
  const failed = useState<string | null>('player-failed', () => null)
  /** Which show's card is on screen right now (null if none). */
  const visibleShow = useState<string | null>('player-visible-show', () => null)
  /** Which show is selected in "Lyssna & titta". */
  const selectedShow = useState<string | null>('podcast-selected', () => null)
  /** Each episode's progress (read from this browser once the page is ready; see restore). */
  const history = useState<ListeningHistory>('listening-history', () => ({}))
  const historyLoaded = useState('listening-history-loaded', () => false)

  const showTitle = computed(() => currentShow.value?.title ?? '')
  const progress = computed(() => (duration.value ? Math.min(100, (position.value / duration.value) * 100) : 0))
  /** The playing show's own card is visible, so the mini-player can step aside. */
  const playerInView = computed(() => !!currentShow.value && visibleShow.value === currentShow.value.id)

  function onError() {
    playing.value = false
    failed.value = 'Ljudet kunde inte spelas här. Lyssna hos podden i stället.'
  }

  /** Where the current episode is: a position not yet applied counts, the element's own 0 doesn't. */
  const where = () => pendingSeek ?? audioEl?.currentTime ?? position.value

  /** Note the current episode's progress in its history entry. */
  function noteProgress(ended = false) {
    const ep = current.value
    if (!ep) return
    history.value = recordProgress(history.value, ep.id, { position: ended ? duration.value : where(), duration: duration.value || undefined, listened: pendingListen, ended, now: Date.now() })
    pendingListen = 0
    writeHistory(storage(), history.value)
  }

  /** Remember where we are (episode, show, position), and the episode's own progress. */
  function persist() {
    const ep = current.value
    const show = currentShow.value
    if (!ep?.audioUrl || !show) return
    lastSave = Date.now()
    writeSession(storage(), { showId: show.id, showTitle: show.title, episode: ep, position: where(), duration: duration.value || undefined })
    noteProgress()
  }

  /** The progress an episode list shows: live for the one playing, from the history for the rest. */
  function progressFor(ep: PodcastEpisode): EpisodeProgress {
    const entry = history.value[ep.id]
    if (current.value?.id === ep.id && duration.value) {
      return episodeProgress({ ...(entry ?? { listened: 0, completed: false, updatedAt: 0 }), position: position.value, duration: duration.value }, ep.durationSeconds)
    }
    return episodeProgress(entry, ep.durationSeconds)
  }

  function attach(el: HTMLAudioElement) {
    if (audioEl === el) return
    audioEl = el
    el.addEventListener('play', () => (playing.value = true))
    el.addEventListener('pause', () => {
      playing.value = false
      persist()
    })
    // Finished: the episode's history says how (completed, or only reached by jumping); the session goes.
    el.addEventListener('ended', () => {
      playing.value = false
      noteProgress(true)
      listenFrom = null
      clearSession(storage())
    })
    el.addEventListener('timeupdate', () => {
      // Until a restored position is applied, the element's 0 isn't where we are.
      if (pendingSeek !== null) return
      position.value = el.currentTime
      if (!el.paused) {
        pendingListen += listenedStep(listenFrom ?? el.currentTime, el.currentTime)
        listenFrom = el.currentTime
      }
      if (!el.paused && Date.now() - lastSave >= SAVE_EVERY_MS) persist()
    })
    // A jump isn't listening: count again from where it lands.
    el.addEventListener('seeking', () => (listenFrom = null))
    el.addEventListener('seeked', persist)
    el.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(el.duration) && el.duration > 0) duration.value = el.duration
      // Now it can seek: pick up where we were.
      if (pendingSeek !== null) {
        const at = Math.min(pendingSeek, duration.value || pendingSeek)
        pendingSeek = null
        if (at > 0) el.currentTime = at
        position.value = at
      }
    })
    el.addEventListener('error', () => current.value && onError())
    // Leaving (closing the tab, reloading, a phone putting the page away).
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist())
    setupMediaSession()
  }

  /**
   * Bring back the last episode, paused where it was. Never plays: that's the
   * supporter's Play. Only when nothing has been chosen yet on this visit.
   */
  function restore(shows: PodcastResponse[] | undefined) {
    const el = audioEl
    if (!historyLoaded.value) {
      historyLoaded.value = true
      // A session saved before there was a history becomes its first entry, kept straight away.
      const stored = readHistory(storage())
      const seeded = seedFromSession(stored, readSession(storage()), Date.now())
      history.value = { ...seeded, ...history.value }
      if (seeded !== stored) writeHistory(storage(), history.value)
    }
    if (!el || current.value) return
    const plan = planRestore(readSession(storage()), shows)
    if (plan.action === 'forget') return clearSession(storage())
    if (plan.action !== 'restore') return
    current.value = plan.episode
    currentShow.value = plan.show
    duration.value = plan.duration ?? 0
    position.value = plan.position
    pendingSeek = plan.position || null
    // With preload="none" this fetches nothing until Play.
    el.src = plan.episode.audioUrl!
    selectedShow.value ??= plan.show.id
    updateMediaSession()
  }

  function detach(el: HTMLAudioElement) {
    if (audioEl === el) audioEl = null
  }

  /** Play/pause an episode. A different episode (from any show) replaces the current stream. */
  async function toggle(ep?: PodcastEpisode, show?: PlayingShow) {
    const el = audioEl
    const target = ep ?? current.value
    if (!el || !target?.audioUrl) return
    failed.value = null
    if (current.value?.id === target.id) {
      if (el.paused) await el.play().catch(onError)
      else el.pause()
      return
    }
    // The outgoing episode's progress first, under its own id; the new one starts from its own point.
    const outgoing = current.value
    const sw = switchEpisode(history.value, outgoing && { id: outgoing.id, position: where(), duration: duration.value || undefined, listened: pendingListen }, target.id, Date.now())
    history.value = sw.history
    writeHistory(storage(), history.value)
    pendingListen = 0
    listenFrom = null
    current.value = target
    if (show) currentShow.value = show
    position.value = sw.startAt
    pendingSeek = sw.startAt || null
    duration.value = history.value[target.id]?.duration ?? target.durationSeconds ?? 0
    el.src = target.audioUrl
    updateMediaSession()
    // Another episode replaces what was remembered.
    persist()
    await el.play().catch(onError)
  }

  function seekTo(seconds: number) {
    const el = audioEl
    if (!el || !duration.value) return
    const at = Math.min(Math.max(0, seconds), duration.value)
    // Nothing loaded yet (a restored episode before Play): start there once it can.
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
      pendingSeek = at
      position.value = at
      persist()
      return
    }
    el.currentTime = at
  }

  const seekBy = (delta: number) => audioEl && seekTo((pendingSeek ?? audioEl.currentTime) + delta)

  /** Click on a progress bar → jump to that point. */
  function seekFromClick(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    seekTo(((e.clientX - rect.left) / rect.width) * duration.value)
  }

  /** Arrow keys on a progress bar: ±15 s. */
  function seekFromKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') seekBy(15)
    if (e.key === 'ArrowLeft') seekBy(-15)
  }

  /** Close the mini-player: pause and forget the active episode (its progress stays in the history). */
  function stop() {
    audioEl?.pause()
    noteProgress()
    listenFrom = null
    current.value = null
    currentShow.value = null
    position.value = 0
    pendingSeek = null
    clearSession(storage())
  }

  // Lock-screen / headset controls via the Media Session API, where supported.
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => void toggle())
    ms.setActionHandler('pause', () => audioEl?.pause())
    ms.setActionHandler('seekbackward', () => seekBy(-15))
    ms.setActionHandler('seekforward', () => seekBy(15))
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !current.value) return
    // No artwork: we don't republish the shows' cover images.
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.value.title, artist: showTitle.value, album: showTitle.value })
  }

  return { current, currentShow, showTitle, playing, position, duration, progress, failed, visibleShow, selectedShow, playerInView, history, progressFor, attach, detach, restore, toggle, seekTo, seekBy, seekFromClick, seekFromKey, stop }
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}
