import { describe, expect, it } from 'vitest'
import type { Story } from '../shared/types/domain'
import { discardPostDraft, emptyPostDraft, keepsPostDraft, POST_DRAFT_KEY, postDraftPreview, readPostDraft, startPostDraft, withMention, writePostDraft } from '../app/lib/postDraft'

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

// The Story you're browsing: a fresh draft starts attached to it, with the article its headline is from
const BROWSED: Story = {
  id: 'story-t-1', sport: 'hockey', leadId: 'sportbladet-2', sharedNames: [], updatedAt: '2026-11-13T10:00:00Z',
  sources: [
    { id: 'bollsvenskan-1', sourceId: 'b', outlet: 'Bollsvenskan', publisher: 'Bollsvenskan', headline: 'Först ut', url: 'https://e.se/1', publishedAt: '2026-11-13T08:00:00Z', sport: 'hockey', reporting: 'compiled' },
    { id: 'sportbladet-2', sourceId: 's', outlet: 'Sportbladet', publisher: 'Aftonbladet', headline: 'Rubriken som visas', url: 'https://e.se/2', publishedAt: '2026-11-13T10:00:00Z', sport: 'hockey', reporting: 'original' },
  ],
}
const BROWSED_ATTACHMENT = { storyId: 'story-t-1', leadId: 'sportbladet-2', headline: 'Rubriken som visas', outlet: 'Sportbladet' }

describe('opening the composer', () => {
  it('leaves a draft in progress exactly as it was', () => {
    const d = { body: 'Halvskrivet', sport: 'hockey' as const, storyId: 'story-1' }
    expect(startPostDraft(d, { sport: 'fotboll', story: BROWSED })).toBe(d)
    const storyOnly = { body: '', storyId: 'story-1' }
    expect(startPostDraft(storyOnly, { story: BROWSED })).toBe(storyOnly)
  })

  it('starts a fresh one from what you’re browsing, with that Story’s lead article and headline', () => {
    expect(startPostDraft(emptyPostDraft(), { sport: 'hockey', story: BROWSED })).toEqual({ body: '', sport: 'hockey', ...BROWSED_ATTACHMENT })
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

describe('throwing a draft away (Släng utkast)', () => {
  const STORY_DRAFTS = 'djurgarn:drafts:v1'

  it('the text and the Story go; the sport stays as the next default', () => {
    expect(discardPostDraft({ body: 'Halvskrivet', sport: 'hockey', storyId: 'story-1' })).toEqual({ body: '', sport: 'hockey' })
    expect(keepsPostDraft(discardPostDraft({ body: 'x', storyId: 'story-1' }))).toBe(false)
  })

  it('removes this account’s stored draft, and only that', () => {
    const s = memoryStorage({ [`${STORY_DRAFTS}:${HASSE}`]: JSON.stringify({ 'story-9': 'Om derbyt…' }) })
    writePostDraft(s, HASSE, { body: 'Hasses', sport: 'fotboll', storyId: 'story-1' })
    writePostDraft(s, LOTTA, { body: 'Lottas' })
    writePostDraft(s, HASSE, discardPostDraft(readPostDraft(s, HASSE)))
    expect(readPostDraft(s, HASSE)).toEqual(emptyPostDraft())
    // Another account's draft, and this account's Story drafts, are untouched.
    expect(readPostDraft(s, LOTTA).body).toBe('Lottas')
    expect(JSON.parse(s.data[`${STORY_DRAFTS}:${HASSE}`]!)).toEqual({ 'story-9': 'Om derbyt…' })
    expect(s.data[`${POST_DRAFT_KEY}:${HASSE}`]).toBeUndefined()
  })

  it('applied the way the store applies changes (merged into the draft), the Story still goes', () => {
    // Regression: a discard without a storyId key left the attached Story in place.
    const draft = { body: '', sport: 'fotboll' as const, storyId: 'story-1' }
    const merged = { ...draft, ...discardPostDraft(draft) }
    expect(merged.storyId).toBeUndefined()
    expect(keepsPostDraft(merged)).toBe(false)
  })

  it('a draft that is only an attached Story is thrown away too', () => {
    const s = memoryStorage()
    writePostDraft(s, HASSE, { body: '', storyId: 'story-1' })
    expect(readPostDraft(s, HASSE).storyId).toBe('story-1')
    writePostDraft(s, HASSE, discardPostDraft(readPostDraft(s, HASSE)))
    expect(s.data).toEqual({})
  })

  it('the next post starts fresh from what you’re browsing, with the sport kept', () => {
    const after = discardPostDraft({ body: 'Slängt', sport: 'hockey', storyId: 'story-1' })
    expect(startPostDraft(after, { sport: 'fotboll', story: BROWSED })).toEqual({ body: '', sport: 'hockey', ...BROWSED_ATTACHMENT })
  })
})

describe('what the compact entry shows of a draft', () => {
  it('its text', () => {
    expect(postDraftPreview({ body: '  Vilken match!  ', storyId: 'story-1' }, 'Derbyt')).toBe('Vilken match!')
  })

  it('a draft that is only an attached Story is still a draft', () => {
    expect(postDraftPreview({ body: '', storyId: 'story-1' }, 'Derbyt avgjort')).toBe('Om: Derbyt avgjort')
    expect(postDraftPreview({ body: ' ', storyId: 'story-1' })).toBe('En Story bifogad')
  })

  it('nothing worth keeping: no draft (a sport alone is only a default)', () => {
    expect(postDraftPreview(emptyPostDraft())).toBeNull()
    expect(postDraftPreview({ body: '  ', sport: 'hockey' })).toBeNull()
    expect(postDraftPreview(discardPostDraft({ body: 'x', sport: 'hockey', storyId: 's' }), 'Derbyt')).toBeNull()
  })
})
