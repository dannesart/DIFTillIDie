import { describe, expect, it } from 'vitest'
import type { PodcastEpisode, PodcastResponse } from '../shared/types/domain'
import type { PlaybackSession } from '../app/lib/playbackSession'
import { clearSession, FINISHED_WITHIN, isFinished, planRestore, readSession, RESUME_FROM, resumeAt, SESSION_KEY, writeSession } from '../app/lib/playbackSession'

/*
 * Remembering where you were in a podcast across a refresh, a browser
 * restart or a new build: only what we wrote, only from a show that's still
 * here, never seconds before the end.
 */

function memoryStorage(data: Record<string, string> = {}) {
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v },
    removeItem: (k: string) => { delete data[k] },
  }
}

const EPISODE: PodcastEpisode = {
  id: 'djurgarnbynight:e5a2a033',
  title: 'Avskedsansökan',
  publishedAt: '2026-10-28T21:02:26.000Z',
  url: 'https://pod.space/djurgarnbynight/avskedsansokan',
  audioUrl: 'https://media.pod.space/djurgarnbynight/recording-16_261028.mp3',
  durationSeconds: 2130,
  excerpt: 'Det ville sig inte när Djurgårn bara ville stundtals.',
}

const SESSION: PlaybackSession = { showId: 'djurgarnbynight', showTitle: 'Djurgårn by night', episode: EPISODE, position: 754.3, duration: 2130.4 }

function show(episodes: PodcastEpisode[], over: Partial<PodcastResponse> = {}): PodcastResponse {
  return {
    id: 'djurgarnbynight',
    show: { title: 'Djurgårn by night', url: 'https://pod.space/djurgarnbynight' },
    episodes,
    status: { outlet: 'Djurgårn by night' } as PodcastResponse['status'],
    cover: 'night',
    tagline: '',
    links: [],
    ...over,
  } as PodcastResponse
}

const stored = (value: unknown) => memoryStorage({ [SESSION_KEY]: JSON.stringify(value) })

describe('saving and reading back', () => {
  it('reads back the episode, show and position it saved', () => {
    const s = memoryStorage()
    writeSession(s, SESSION)
    const back = readSession(s)!
    expect(back).toMatchObject({ showId: 'djurgarnbynight', showTitle: 'Djurgårn by night', position: 754.3, duration: 2130.4 })
    expect(back.episode).toMatchObject({ id: EPISODE.id, title: EPISODE.title, url: EPISODE.url, audioUrl: EPISODE.audioUrl, durationSeconds: 2130 })
  })

  it('keeps only what it takes to play it again (no show notes)', () => {
    const s = memoryStorage()
    writeSession(s, SESSION)
    expect(JSON.parse(s.data[SESSION_KEY]!).episode.excerpt).toBeUndefined()
  })

  it('a new episode replaces the old one: there is only ever one session', () => {
    const s = memoryStorage()
    writeSession(s, SESSION)
    writeSession(s, { ...SESSION, episode: { ...EPISODE, id: 'djurgarnbynight:next', title: 'Nästa' }, position: 0 })
    expect(Object.keys(s.data)).toEqual([SESSION_KEY])
    expect(readSession(s)).toMatchObject({ position: 0, episode: { id: 'djurgarnbynight:next' } })
  })

  it('closing the player forgets it', () => {
    const s = memoryStorage()
    writeSession(s, SESSION)
    clearSession(s)
    expect(readSession(s)).toBeNull()
  })
})

describe('what storage holds is checked before use', () => {
  it('nothing stored, corrupt data, or no storage: no session', () => {
    expect(readSession(memoryStorage())).toBeNull()
    expect(readSession(memoryStorage({ [SESSION_KEY]: '{not json' }))).toBeNull()
    expect(readSession(memoryStorage({ [SESSION_KEY]: '"a string"' }))).toBeNull()
    expect(readSession(undefined)).toBeNull()
  })

  it('blocked storage (getItem throws) never breaks the page', () => {
    const blocked = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceeded') }, removeItem: () => { throw new Error('SecurityError') } }
    expect(readSession(blocked)).toBeNull()
    expect(() => writeSession(blocked, SESSION)).not.toThrow()
    expect(() => clearSession(blocked)).not.toThrow()
  })

  it('refuses audio that isn’t a web address', () => {
    for (const audioUrl of ['javascript:alert(1)', 'data:audio/mp3;base64,AAAA', 'blob:https://x/y', 'not a url', ''])
      expect(readSession(stored({ ...SESSION, episode: { ...EPISODE, audioUrl } }))).toBeNull()
  })

  it('refuses an episode that doesn’t belong to its show', () => {
    expect(readSession(stored({ ...SESSION, episode: { ...EPISODE, id: 'blarandigtsnack:e5a2a033' } }))).toBeNull()
    expect(readSession(stored({ ...SESSION, episode: { ...EPISODE, id: 'djurgarnbynightX:e5a2a033' } }))).toBeNull()
  })

  it('refuses impossible positions and missing fields', () => {
    for (const position of [-1, Number.NaN, '754', null, 1e9]) expect(readSession(stored({ ...SESSION, position }))).toBeNull()
    expect(readSession(stored({ ...SESSION, showTitle: undefined }))).toBeNull()
    expect(readSession(stored({ ...SESSION, episode: { ...EPISODE, title: 42 } }))).toBeNull()
    expect(readSession(stored({ ...SESSION, episode: null }))).toBeNull()
  })

  it('drops a nonsense duration rather than the session', () => {
    expect(readSession(stored({ ...SESSION, duration: -5 }))!.duration).toBeUndefined()
    expect(readSession(stored({ ...SESSION, duration: 'long' }))!.duration).toBeUndefined()
  })
})

describe('finished episodes', () => {
  it('is finished within the last stretch, or past the end', () => {
    expect(isFinished(2130 - FINISHED_WITHIN, 2130)).toBe(true)
    expect(isFinished(2130, 2130)).toBe(true)
    expect(isFinished(2130 - FINISHED_WITHIN - 1, 2130)).toBe(false)
    expect(isFinished(5000)).toBe(false) // length unknown: never assumed finished
  })

  it('starts from the top when barely begun or finished', () => {
    expect(resumeAt(RESUME_FROM - 1, 2130)).toBe(0)
    expect(resumeAt(754.3, 2130)).toBe(754.3)
    expect(resumeAt(2120, 2130)).toBe(0)
  })
})

describe('bringing it back on the next visit', () => {
  it('restores the episode at its position, from the feed’s own fresher copy', () => {
    const fresh = { ...EPISODE, audioUrl: 'https://media.pod.space/djurgarnbynight/recording-16_261028.mp3?v=2' }
    const plan = planRestore(SESSION, [show([fresh])])
    expect(plan).toEqual({ action: 'restore', episode: fresh, show: { id: 'djurgarnbynight', title: 'Djurgårn by night' }, position: 754.3, duration: 2130.4 })
  })

  it('an older episode no longer in the latest feed still resumes, from what was kept', () => {
    const plan = planRestore(SESSION, [show([{ ...EPISODE, id: 'djurgarnbynight:newer', title: 'Nyare' }])])
    expect(plan).toMatchObject({ action: 'restore', episode: { id: EPISODE.id, audioUrl: EPISODE.audioUrl }, position: 754.3 })
  })

  it('a feed that is down (no episodes) still lets it resume', () => {
    expect(planRestore(SESSION, [show([])])).toMatchObject({ action: 'restore', episode: { id: EPISODE.id } })
  })

  it('a feed copy without audio doesn’t replace the one that has it', () => {
    const plan = planRestore(SESSION, [show([{ ...EPISODE, audioUrl: undefined }])])
    expect(plan).toMatchObject({ action: 'restore', episode: { audioUrl: EPISODE.audioUrl } })
  })

  it('uses the show’s current title', () => {
    const plan = planRestore(SESSION, [show([EPISODE], { show: { title: 'Djurgårn by Night', url: 'https://pod.space/djurgarnbynight' } })])
    expect(plan).toMatchObject({ show: { title: 'Djurgårn by Night' } })
  })

  it('forgets an episode whose show is no longer on the site', () => {
    expect(planRestore(SESSION, [show([], { id: 'blarandigtsnack' })])).toEqual({ action: 'forget' })
  })

  it('forgets a finished episode instead of resuming seconds before the end', () => {
    expect(planRestore({ ...SESSION, position: 2125 }, [show([EPISODE])])).toEqual({ action: 'forget' })
    // Length known only from the feed: still recognised.
    expect(planRestore({ ...SESSION, position: 2120, duration: undefined }, [show([EPISODE])])).toEqual({ action: 'forget' })
  })

  it('barely started: the episode comes back, from the top', () => {
    expect(planRestore({ ...SESSION, position: 2 }, [show([EPISODE])])).toMatchObject({ action: 'restore', position: 0 })
  })

  it('leaves things be when there is nothing, or the shows didn’t load', () => {
    expect(planRestore(null, [show([EPISODE])])).toEqual({ action: 'none' })
    expect(planRestore(SESSION, undefined)).toEqual({ action: 'none' })
    expect(planRestore(SESSION, [])).toEqual({ action: 'none' })
  })
})
