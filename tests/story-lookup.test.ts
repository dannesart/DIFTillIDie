import { describe, expect, it } from 'vitest'
import type { Story } from '../shared/types/domain'
import { tokenize } from '../app/utils/text'
import { createComposerOpen } from '../app/lib/composerState'
import { createInlineLookup, findTrigger, matchStories, moveActive, removeTrigger } from '../app/lib/storyLookup'

/* Attaching a Story from the composer: `#` suggestions and "Bifoga". */

function story(id: string, headline: string, outlet = 'Sportbladet', updatedAt = '2026-11-03T12:00:00Z', more: string[] = []): Story {
  const art = (aid: string, h: string, o: string) => ({
    id: aid, sourceId: 'x', outlet: o, publisher: o === 'Sportbladet' ? 'Aftonbladet' : o, headline: h,
    url: `https://example.se/${aid}`, publishedAt: updatedAt, sport: 'fotboll' as const, reporting: 'original' as const,
  })
  const sources = [art(id, headline, outlet), ...more.map((h, i) => art(`${id}-${i}`, h, 'Expressen'))]
  return { id: `story-${id}`, sport: 'fotboll', sources, leadId: id, sharedNames: [], updatedAt }
}

const STORIES = [
  story('a', 'Derbyt avgjort i sista minuten', 'Sportbladet', '2026-11-03T10:00:00Z'),
  story('b', 'Ny tränare presenteras på Kanalplan', 'Fotbollskanalen', '2026-11-03T12:00:00Z'),
  story('c', 'Klart: mittfältaren lämnar för Malmö', 'Expressen', '2026-11-02T09:00:00Z', ['Derbyhjälten flyttar söderut']),
]

describe('finding the `#word` at the caret', () => {
  it('a `#` with text before the caret is a lookup', () => {
    const text = 'Vilken match #derb'
    expect(findTrigger(text, text.length)).toEqual({ start: 13, end: 18, query: 'derb' })
  })

  it('takes the whole word, even past the caret', () => {
    expect(findTrigger('#derbyt nu', 3)).toEqual({ start: 0, end: 7, query: 'derbyt' })
  })

  it('handles Swedish letters, digits and _', () => {
    expect(findTrigger('#ny_tränare2', 12)?.query).toBe('ny_tränare2')
  })

  it('nothing for a bare `#`, a finished word, mid-word `#`, or a selection', () => {
    expect(findTrigger('Heja #', 6)).toBeNull()
    expect(findTrigger('#derby ', 7)).toBeNull()
    expect(findTrigger('abc#derby', 9)).toBeNull()
    expect(findTrigger('#derby', 2, 5)).toBeNull()
    expect(findTrigger('@derby', 6)).toBeNull()
  })

  it('a `#` after a line break or bracket counts', () => {
    expect(findTrigger('Heja\n#der', 9)?.start).toBe(5)
    expect(findTrigger('(#der', 5)?.start).toBe(1)
  })
})

describe('removing the `#query` once a Story is chosen (caret)', () => {
  it('at the end: keeps the space before, caret at the end', () => {
    expect(removeTrigger('Vilken kväll #derb', { start: 13, end: 18 })).toEqual({ text: 'Vilken kväll ', caret: 13 })
  })

  it('in the middle: no double space, caret where the token was', () => {
    expect(removeTrigger('Vilken #derb match', { start: 7, end: 12 })).toEqual({ text: 'Vilken match', caret: 7 })
  })

  it('at the start, and alone', () => {
    expect(removeTrigger('#derb heja', { start: 0, end: 5 })).toEqual({ text: 'heja', caret: 0 })
    expect(removeTrigger('#derb', { start: 0, end: 5 })).toEqual({ text: '', caret: 0 })
  })

  it('leaves line breaks and every other character alone', () => {
    expect(removeTrigger('Rad ett\n#derb\nRad tre', { start: 8, end: 13 })).toEqual({ text: 'Rad ett\n\nRad tre', caret: 8 })
  })
})

describe('matching Stories', () => {
  it('word starts in the original headline, case- and accent-insensitive', () => {
    expect(matchStories(STORIES, 'derb').map(s => s.id)).toEqual(['story-a', 'story-c'])
    expect(matchStories(STORIES, 'malmo').map(s => s.id)).toEqual(['story-c'])
    expect(matchStories(STORIES, 'TRÄN').map(s => s.id)).toEqual(['story-b'])
  })

  it('the lead headline ranks above a match in another source', () => {
    expect(matchStories(STORIES, 'derby')[0]!.id).toBe('story-a')
  })

  it('finds by outlet and publisher too; every word must match', () => {
    expect(matchStories(STORIES, 'aftonbladet').map(s => s.id)).toEqual(['story-a'])
    expect(matchStories(STORIES, 'ny_tränare').map(s => s.id)).toEqual(['story-b'])
    expect(matchStories(STORIES, 'ny malmö')).toEqual([])
  })

  it('no match is an honest empty list, never a guess', () => {
    expect(matchStories(STORIES, 'zlatan')).toEqual([])
    expect(matchStories([], 'derby')).toEqual([])
  })

  it('an empty query lists the latest Stories, capped', () => {
    expect(matchStories(STORIES, '').map(s => s.id)).toEqual(['story-b', 'story-a', 'story-c'])
    expect(matchStories(STORIES, '', 2)).toHaveLength(2)
  })
})

describe('arrow keys', () => {
  it('nothing is active until an arrow is pressed; then it wraps', () => {
    expect(moveActive(-1, 1, 3)).toBe(0)
    expect(moveActive(-1, -1, 3)).toBe(2)
    expect(moveActive(2, 1, 3)).toBe(0)
    expect(moveActive(0, -1, 3)).toBe(2)
    expect(moveActive(-1, 1, 0)).toBe(-1)
  })
})

function inline(attached = false) {
  const l = createInlineLookup({ stories: () => STORIES, enabled: () => !attached })
  let text = ''
  const type = (s: string) => {
    text += s
    l.sync(text, text.length)
  }
  return { l, type, get text() { return text } }
}

describe('the `#` suggestions', () => {
  it('typing #derby and carrying on stays an ordinary hashtag', () => {
    const t = inline()
    t.type('Vilket #derby')
    expect(t.l.open.value).toBe(true)
    // Enter without choosing is a new line, not an attachment.
    expect(t.l.key('Enter')).toBe(false)
    t.type(' i kväll!')
    expect(t.l.open.value).toBe(false)
    expect(tokenize(t.text)).toContainEqual({ type: 'tag', value: 'derby' })
  })

  it('arrow down + Enter chooses: the token goes, the rest stays, the Story is structured', () => {
    const t = inline()
    t.type('Heja #derb')
    expect(t.l.key('ArrowDown')).toBe(true)
    const picked = t.l.key('Enter')
    expect(picked).toMatchObject({ id: 'story-a' })
    const r = t.l.choose(t.text, picked as Story)
    expect(r).toEqual({ text: 'Heja ', caret: 5, storyId: 'story-a' })
    expect(t.l.open.value).toBe(false)
  })

  it('a tap chooses the same way (no arrows needed)', () => {
    const t = inline()
    t.type('#tränare')
    expect(t.l.choose(t.text, STORIES[1]!)).toEqual({ text: '', caret: 0, storyId: 'story-b' })
  })

  it('Escape dismisses without touching the text, and stays dismissed for that word', () => {
    const t = inline()
    t.type('Heja #derb')
    expect(t.l.key('Escape')).toBe(true)
    expect([t.l.open.value, t.text]).toEqual([false, 'Heja #derb'])
    t.type('y')
    expect(t.l.open.value).toBe(false)
    // A new `#word` asks again.
    t.type(' #trä')
    expect(t.l.open.value).toBe(true)
  })

  it('no match: open, with an empty list (shown as "it stays a hashtag")', () => {
    const t = inline()
    t.type('#zlatan')
    expect([t.l.open.value, t.l.results.value]).toEqual([true, []])
    expect(t.l.key('ArrowDown')).toBe(false)
  })

  it('quiet while a Story is attached: one Story per post, and hashtags stay hashtags', () => {
    const t = inline(true)
    t.type('#derb')
    expect(t.l.open.value).toBe(false)
    expect(t.l.key('ArrowDown')).toBe(false)
  })

  it('a new query resets the active suggestion', () => {
    const t = inline()
    t.type('#d')
    t.l.key('ArrowDown')
    expect(t.l.active.value).toBe(0)
    t.type('e')
    expect(t.l.active.value).toBe(-1)
  })
})

describe('focus while attaching', () => {
  it('moving into the suggestions or the Bifoga search keeps an empty composer open', () => {
    let storyId = ''
    const c = createComposerOpen(() => !storyId)
    c.enter() // Bifoga clicked in an empty composer
    c.leave('inside') // focus to the search field
    c.enter()
    storyId = 'story-a' // chosen; the search field disappears
    c.leave('nowhere')
    expect(c.open.value).toBe(true)
  })
})
