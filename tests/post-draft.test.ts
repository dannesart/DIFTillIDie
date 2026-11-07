import { describe, expect, it } from 'vitest'
import { emptyPostDraft, keepsPostDraft, POST_DRAFT_KEY, readPostDraft, startPostDraft, withMention, writePostDraft } from '../app/lib/postDraft'

/*
 * Mission #18: the Snacket post written in the compose dialog survives
 * closing and reloading, and never crosses from one supporter to another.
 */

function memoryStorage(data: Record<string, string> = {}) {
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v },
    removeItem: (k: string) => { delete data[k] },
  }
}

const HASSE = 'account:aaaa-1' as const
const LOTTA = 'account:bbbb-2' as const

describe('whose draft', () => {
  it('reads back what was written, for the same supporter', () => {
    const s = memoryStorage()
    writePostDraft(s, HASSE, { body: 'Vilken match!', sport: 'hockey', storyId: 'story-1' })
    expect(readPostDraft(s, HASSE)).toEqual({ body: 'Vilken match!', sport: 'hockey', storyId: 'story-1' })
  })

  it('never shows one supporter’s draft to another, or to a guest', () => {
    const s = memoryStorage()
    writePostDraft(s, HASSE, { body: 'Hasses hemliga utkast', storyId: 'story-1' })
    expect(readPostDraft(s, LOTTA)).toEqual(emptyPostDraft())
    expect(readPostDraft(s, 'guest')).toEqual(emptyPostDraft())
  })

  it('keeps each supporter under a key of their own', () => {
    const s = memoryStorage()
    writePostDraft(s, HASSE, { body: 'Hasse' })
    writePostDraft(s, LOTTA, { body: 'Lotta' })
    expect(Object.keys(s.data).sort()).toEqual([`${POST_DRAFT_KEY}:${HASSE}`, `${POST_DRAFT_KEY}:${LOTTA}`])
    expect(readPostDraft(s, HASSE).body).toBe('Hasse')
    expect(readPostDraft(s, LOTTA).body).toBe('Lotta')
  })

  it('clearing one supporter’s draft leaves the other’s alone', () => {
    const s = memoryStorage()
    writePostDraft(s, HASSE, { body: 'Hasse' })
    writePostDraft(s, LOTTA, { body: 'Lotta' })
    writePostDraft(s, HASSE, { body: '', sport: 'fotboll' })
    expect(readPostDraft(s, HASSE)).toEqual(emptyPostDraft())
    expect(readPostDraft(s, LOTTA).body).toBe('Lotta')
  })
})

describe('what is worth keeping', () => {
  it('is some text or a chosen Story; a sport alone is only a default', () => {
    expect(keepsPostDraft({ body: '  \n ' })).toBe(false)
    expect(keepsPostDraft({ body: '', sport: 'hockey' })).toBe(false)
    expect(keepsPostDraft({ body: 'Hej' })).toBe(true)
    expect(keepsPostDraft({ body: '', storyId: 'story-1' })).toBe(true)
  })

  it('a published (emptied) draft is removed from storage', () => {
    const s = memoryStorage()
    writePostDraft(s, HASSE, { body: 'Ute snart' })
    writePostDraft(s, HASSE, { body: '', sport: 'hockey', storyId: undefined })
    expect(s.data).toEqual({})
  })

  it('a failed publish changes nothing: the draft is still there to try again', () => {
    const s = memoryStorage()
    const draft = { body: 'Försöker igen', sport: 'fotboll' as const, storyId: 'story-1' }
    writePostDraft(s, HASSE, draft)
    expect(readPostDraft(s, HASSE)).toEqual(draft)
  })
})

describe('reading what storage holds', () => {
  it('keeps only what a draft can hold', () => {
    const s = memoryStorage({ [`${POST_DRAFT_KEY}:${HASSE}`]: JSON.stringify({ body: 42, sport: 'curling', storyId: '', author: 'lotta' }) })
    expect(readPostDraft(s, HASSE)).toEqual({ body: '', sport: undefined, storyId: undefined })
  })

  it('starts fresh from corrupt data, or without storage', () => {
    const s = memoryStorage({ [`${POST_DRAFT_KEY}:${HASSE}`]: '{not json' })
    expect(readPostDraft(s, HASSE)).toEqual(emptyPostDraft())
    expect(readPostDraft(undefined, HASSE)).toEqual(emptyPostDraft())
  })

  it('a full or blocked storage never breaks writing', () => {
    const blocked = { setItem: () => { throw new Error('QuotaExceeded') }, removeItem: () => { throw new Error('SecurityError') } }
    expect(() => writePostDraft(blocked, HASSE, { body: 'Hej' })).not.toThrow()
    expect(() => writePostDraft(blocked, HASSE, { body: '' })).not.toThrow()
  })
})

describe('opening the composer', () => {
  it('leaves a draft in progress exactly as it was', () => {
    const d = { body: 'Halvskrivet', sport: 'hockey' as const, storyId: 'story-1' }
    expect(startPostDraft(d, { sport: 'fotboll', storyId: 'story-2' })).toBe(d)
    const storyOnly = { body: '', storyId: 'story-1' }
    expect(startPostDraft(storyOnly, { storyId: 'story-2' })).toBe(storyOnly)
  })

  it('starts a fresh one from what you’re browsing', () => {
    expect(startPostDraft(emptyPostDraft(), { sport: 'hockey', storyId: 'story-2' })).toEqual({ body: '', sport: 'hockey', storyId: 'story-2' })
    expect(startPostDraft(emptyPostDraft(), {})).toEqual({ body: '', sport: undefined, storyId: undefined })
  })

  it('keeps a sport already chosen', () => {
    expect(startPostDraft({ body: '', sport: 'fotboll' }, { sport: 'hockey' }).sport).toBe('fotboll')
  })
})

describe('an @mention, ready to use', () => {
  it('goes at the end, with a space to write after', () => {
    expect(withMention('', 'jarnmannen')).toBe('@jarnmannen ')
    expect(withMention('Håller med', 'jarnmannen')).toBe('Håller med @jarnmannen ')
    expect(withMention('Håller med ', 'jarnmannen')).toBe('Håller med @jarnmannen ')
    expect(withMention('Rad ett\n', 'jarnmannen')).toBe('Rad ett\n@jarnmannen ')
  })

  it('isn’t added twice', () => {
    expect(withMention('@jarnmannen bra sagt', 'jarnmannen')).toBe('@jarnmannen bra sagt ')
    expect(withMention('Tack @jarnmannen', 'jarnmannen')).toBe('Tack @jarnmannen ')
    expect(withMention('Tack @Jarnmannen ', 'jarnmannen')).toBe('Tack @Jarnmannen ')
  })

  it('a longer handle that starts the same is someone else', () => {
    expect(withMention('Hej @jarnmannen2', 'jarnmannen')).toBe('Hej @jarnmannen2 @jarnmannen ')
  })
})
