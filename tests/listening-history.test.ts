import { describe, expect, it } from 'vitest'
import type { ListeningHistory } from '../app/lib/listeningHistory'
import { bound, COMPLETE_SHARE, episodeProgress, HISTORY_KEY, HISTORY_LIMIT, listenedStep, progressLabel, readHistory, recordProgress, resumePoint, seedFromSession, switchEpisode, writeHistory } from '../app/lib/listeningHistory'
import type { PlaybackSession } from '../app/lib/playbackSession'

/*
 * Each episode's own listening progress: A → B → A picks A up where it was,
 * the outgoing episode's position never lands on the incoming one, and
 * "completed" means really listened to the end.
 */

function memoryStorage(data: Record<string, string> = {}) {
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v },
  }
}

const A = 'blarandigtsnack:ep-a'
const B = 'djurgarnbynight:ep-b'
const C = 'blarandigtsnack:ep-c'
const HOUR = 3600
const T0 = Date.UTC(2026, 10, 8, 20)

describe('switching episodes: A → B → A', () => {
  it('notes the outgoing episode under its own id, and starts the incoming one from its own point', () => {
    // Twenty minutes into A, then B is started.
    const toB = switchEpisode({}, { id: A, position: 1200, duration: HOUR, listened: 1200 }, B, T0)
    expect(toB.history[A]).toMatchObject({ position: 1200, duration: HOUR, completed: false })
    expect(toB.startAt).toBe(0) // B is new: from the top, never from A's 20 minutes
    expect(toB.history[B]).toBeUndefined()
    // Five minutes into B, then back to A.
    const toA = switchEpisode(toB.history, { id: B, position: 300, duration: 2 * HOUR, listened: 300 }, A, T0 + 1)
    expect(toA.startAt).toBe(1200)
    expect(toA.history[B]).toMatchObject({ position: 300 })
    // And B again: its own five minutes.
    expect(switchEpisode(toA.history, { id: A, position: 1260, duration: HOUR, listened: 60 }, B, T0 + 2).startAt).toBe(300)
  })

  it('a position not yet applied counts as where the outgoing episode is (restored, then switched away)', () => {
    // The caller passes the pending position; the element's own 0 must never overwrite progress.
    const h = recordProgress({}, A, { position: 1200, duration: HOUR, now: T0 })
    const out = switchEpisode(h, { id: A, position: 1200, duration: HOUR }, B, T0 + 1)
    expect(out.history[A]!.position).toBe(1200)
  })

  it('starting nothing new (same episode) changes nothing', () => {
    const h = recordProgress({}, A, { position: 600, duration: HOUR, now: T0 })
    expect(switchEpisode(h, { id: A, position: 999, duration: HOUR }, A, T0 + 1)).toEqual({ history: h, startAt: 600 })
  })

  it('the very first episode has nothing outgoing', () => {
    expect(switchEpisode({}, null, A, T0)).toEqual({ history: {}, startAt: 0 })
  })
})

describe('completed means really listened to the end', () => {
  it('reaching the end after playing most of it completes it, and it starts from the top next time', () => {
    const h = recordProgress({}, A, { position: HOUR, duration: HOUR, listened: 0.9 * HOUR, ended: true, now: T0 })
    expect(h[A]).toMatchObject({ completed: true, position: 0 })
    expect(resumePoint(h[A])).toBe(0)
    expect(episodeProgress(h[A])).toEqual({ state: 'completed' })
  })

  it('listened time adds up across visits', () => {
    let h = recordProgress({}, A, { position: 0.3 * HOUR, duration: HOUR, listened: 0.3 * HOUR, now: T0 })
    h = recordProgress(h, A, { position: HOUR, duration: HOUR, listened: 0.25 * HOUR, ended: true, now: T0 + 1 })
    expect(h[A]!.completed).toBe(true)
  })

  it('jumping to the last minutes and letting it end is not completing it', () => {
    const h = recordProgress({}, A, { position: HOUR, duration: HOUR, listened: 120, ended: true, now: T0 })
    expect(h[A]!.completed).toBe(false)
    // Nothing to show: not done, and no sensible point to resume (not seconds before the end).
    expect(resumePoint(h[A])).toBe(0)
    expect(episodeProgress(h[A])).toEqual({ state: 'none' })
  })

  it(`exactly ${COMPLETE_SHARE * 100} % played is enough; less isn't`, () => {
    expect(recordProgress({}, A, { position: HOUR, duration: HOUR, listened: COMPLETE_SHARE * HOUR, ended: true, now: T0 })[A]!.completed).toBe(true)
    expect(recordProgress({}, A, { position: HOUR, duration: HOUR, listened: COMPLETE_SHARE * HOUR - 1, ended: true, now: T0 })[A]!.completed).toBe(false)
  })

  it('paused in the last stretch after listening to most of it also completes it', () => {
    expect(recordProgress({}, A, { position: HOUR - 10, duration: HOUR, listened: 0.8 * HOUR, now: T0 })[A]).toMatchObject({ completed: true, position: 0 })
  })

  it('only opened (a few seconds in): nothing to show', () => {
    expect(episodeProgress(recordProgress({}, A, { position: 2, duration: HOUR, listened: 2, now: T0 })[A])).toEqual({ state: 'none' })
  })

  it('without a known length it never counts as completed', () => {
    expect(recordProgress({}, A, { position: 5000, listened: 5000, ended: true, now: T0 })[A]!.completed).toBe(false)
  })
})

describe('playing a finished episode again', () => {
  it('starts from the top, and stays completed while replaying', () => {
    let h = recordProgress({}, A, { position: HOUR, duration: HOUR, listened: HOUR, ended: true, now: T0 })
    expect(switchEpisode(h, null, A, T0 + 1).startAt).toBe(0)
    h = recordProgress(h, A, { position: 900, duration: HOUR, listened: 900, now: T0 + 2 })
    expect(h[A]!.completed).toBe(true)
    expect(resumePoint(h[A])).toBe(900) // the replay resumes where it is
  })
})

describe('listened time counts playing, not jumping', () => {
  it('small steps forward count; jumps, rewinds and standing still do not', () => {
    expect(listenedStep(100, 100.25)).toBeCloseTo(0.25)
    expect(listenedStep(100, 102.9)).toBeCloseTo(2.9)
    expect(listenedStep(100, 160)).toBe(0) // a seek forward
    expect(listenedStep(100, 40)).toBe(0) // a seek back
    expect(listenedStep(100, 100)).toBe(0)
  })

  it('never more than the episode is long', () => {
    expect(recordProgress({}, A, { position: 600, duration: 900, listened: 5000, now: T0 })[A]!.listened).toBe(900)
  })
})

describe('lengths that differ, or are missing', () => {
  it('the audio’s own length wins over the feed’s (ads can make it longer)', () => {
    const h = recordProgress({}, A, { position: 1800, duration: 3355, now: T0 })
    expect(episodeProgress(h[A], 3226)).toEqual({ state: 'progress', fraction: 1800 / 3355, remaining: 3355 - 1800 })
  })

  it('a later, shorter length keeps the position inside it', () => {
    let h = recordProgress({}, A, { position: 3300, duration: 3355, now: T0 })
    h = recordProgress(h, A, { position: 3300, duration: 3226, now: T0 + 1 })
    expect(h[A]!.position).toBe(3226)
  })

  it('no length from the audio: the feed’s; neither: begun, without a bar', () => {
    const h = recordProgress({}, A, { position: 600, now: T0 })
    expect(episodeProgress(h[A], HOUR)).toEqual({ state: 'progress', fraction: 600 / HOUR, remaining: HOUR - 600 })
    expect(episodeProgress(h[A])).toEqual({ state: 'progress', fraction: 0, remaining: null })
    expect(progressLabel(episodeProgress(h[A]))).toBe('Påbörjad')
  })
})

describe('what the lists say', () => {
  it('minutes left, hours and minutes, or done', () => {
    expect(progressLabel({ state: 'progress', fraction: 0.5, remaining: 12 * 60 + 20 })).toBe('12 min kvar')
    expect(progressLabel({ state: 'progress', fraction: 0.1, remaining: 65 * 60 })).toBe('1 h 5 min kvar')
    expect(progressLabel({ state: 'progress', fraction: 0.99, remaining: 10 })).toBe('1 min kvar')
    expect(progressLabel({ state: 'completed' })).toBe('Lyssnad')
    expect(progressLabel({ state: 'none' })).toBeNull()
  })

  it('an episode never played shows nothing', () => {
    expect(episodeProgress(undefined, HOUR)).toEqual({ state: 'none' })
  })
})

describe('kept in this browser, bounded', () => {
  it('reads back what was written', () => {
    const s = memoryStorage()
    const h = recordProgress(recordProgress({}, A, { position: 1200, duration: HOUR, listened: 1200, now: T0 }), B, { position: 300, duration: 2 * HOUR, now: T0 + 1 })
    writeHistory(s, h)
    expect(readHistory(s)).toEqual(h)
  })

  it(`keeps the ${HISTORY_LIMIT} most recently played episodes`, () => {
    let h: ListeningHistory = {}
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recordProgress(h, `blarandigtsnack:ep-${i}`, { position: 600, duration: HOUR, now: T0 + i })
    expect(Object.keys(h)).toHaveLength(HISTORY_LIMIT)
    expect(h['blarandigtsnack:ep-0']).toBeUndefined()
    expect(h[`blarandigtsnack:ep-${HISTORY_LIMIT + 4}`]).toBeDefined()
    expect(Object.keys(bound(h, 3)).sort()).toEqual([`blarandigtsnack:ep-${HISTORY_LIMIT + 2}`, `blarandigtsnack:ep-${HISTORY_LIMIT + 3}`, `blarandigtsnack:ep-${HISTORY_LIMIT + 4}`].sort())
  })

  it('drops whatever isn’t an entry it could have written', () => {
    const s = memoryStorage({ [HISTORY_KEY]: JSON.stringify({
      [A]: { position: 600, duration: HOUR, listened: 600, completed: false, updatedAt: T0 },
      'not-an-episode-id': { position: 1, updatedAt: T0 },
      [B]: { position: -5, updatedAt: T0 },
      [C]: { position: 'lots', updatedAt: T0 },
      'blarandigtsnack:ep-d': { position: 30, duration: 'long', listened: -1, completed: 'yes', updatedAt: T0 },
    }) })
    const h = readHistory(s)
    expect(Object.keys(h).sort()).toEqual([A, 'blarandigtsnack:ep-d'].sort())
    expect(h['blarandigtsnack:ep-d']).toEqual({ position: 30, duration: undefined, listened: 0, completed: false, updatedAt: T0 })
  })

  it('corrupt, missing or blocked storage starts empty and never breaks the page', () => {
    expect(readHistory(memoryStorage({ [HISTORY_KEY]: '{oops' }))).toEqual({})
    expect(readHistory(memoryStorage({ [HISTORY_KEY]: '[1,2]' }))).toEqual({})
    expect(readHistory(undefined)).toEqual({})
    const blocked = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceeded') } }
    expect(readHistory(blocked)).toEqual({})
    expect(() => writeHistory(blocked, { [A]: { position: 1, listened: 0, completed: false, updatedAt: T0 } })).not.toThrow()
  })
})

describe('upgrading: a session saved before there was a history', () => {
  const session: PlaybackSession = {
    showId: 'blarandigtsnack',
    showTitle: 'Blårandigt Snack',
    episode: { id: A, title: 'Försnack', url: 'https://example.se/a', audioUrl: 'https://example.se/a.mp3', publishedAt: '2026-11-06T10:00:00Z', durationSeconds: 3264 },
    position: 754,
    duration: 3265,
  }

  it('becomes the first history entry, so its episode shows its progress', () => {
    const h = seedFromSession({}, session, T0)
    expect(h[A]).toMatchObject({ position: 754, duration: 3265, completed: false })
    expect(resumePoint(h[A])).toBe(754)
  })

  it('never overwrites what the history already knows, and nothing comes from no session', () => {
    const known = recordProgress({}, A, { position: 2000, duration: 3265, now: T0 })
    expect(seedFromSession(known, session, T0 + 1)).toBe(known)
    expect(seedFromSession({}, null, T0)).toEqual({})
  })

  it('a session without the audio’s length uses the feed’s', () => {
    expect(seedFromSession({}, { ...session, duration: undefined }, T0)[A]!.duration).toBe(3264)
  })
})
