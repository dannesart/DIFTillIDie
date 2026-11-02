import type { PodcastEpisode } from '#shared/types/domain'

/*
 * One player, many controls, any show. The single <audio> element lives in
 * PodcastAudio (mounted once for the whole page) and registers itself here;
 * the show cards and the mini-player all read and drive the same state, so
 * only one stream can ever play. Playback only starts from a click.
 */

export interface PlayingShow {
  id: string
  title: string
}

// The element itself is browser-only, so it lives outside useState.
let audioEl: HTMLAudioElement | null = null

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

  const showTitle = computed(() => currentShow.value?.title ?? '')
  const progress = computed(() => (duration.value ? Math.min(100, (position.value / duration.value) * 100) : 0))
  /** The playing show's own card is visible, so the mini-player can step aside. */
  const playerInView = computed(() => !!currentShow.value && visibleShow.value === currentShow.value.id)

  function onError() {
    playing.value = false
    failed.value = 'Ljudet kunde inte spelas här. Lyssna hos podden i stället.'
  }

  function attach(el: HTMLAudioElement) {
    if (audioEl === el) return
    audioEl = el
    el.addEventListener('play', () => (playing.value = true))
    el.addEventListener('pause', () => (playing.value = false))
    el.addEventListener('ended', () => (playing.value = false))
    el.addEventListener('timeupdate', () => (position.value = el.currentTime))
    el.addEventListener('loadedmetadata', () => (duration.value = el.duration || duration.value))
    el.addEventListener('error', () => current.value && onError())
    setupMediaSession()
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
    current.value = target
    if (show) currentShow.value = show
    position.value = 0
    duration.value = target.durationSeconds ?? 0
    el.src = target.audioUrl
    updateMediaSession()
    await el.play().catch(onError)
  }

  function seekTo(seconds: number) {
    if (!audioEl || !duration.value) return
    audioEl.currentTime = Math.min(Math.max(0, seconds), duration.value)
  }

  const seekBy = (delta: number) => audioEl && seekTo(audioEl.currentTime + delta)

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

  /** Close the mini-player: pause and forget the episode. */
  function stop() {
    audioEl?.pause()
    current.value = null
    currentShow.value = null
    position.value = 0
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

  return { current, currentShow, showTitle, playing, position, duration, progress, failed, visibleShow, selectedShow, playerInView, attach, detach, toggle, seekTo, seekBy, seekFromClick, seekFromKey, stop }
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}
