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

  it('a bare `#` is a lookup with an empty query', () => {
    expect(findTrigger('#', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(findTrigger('Heja #', 6)).toEqual({ start: 5, end: 6, query: '' })
    // Caret right after the `#`, a word already following it
    expect(findTrigger('#derby', 1)).toEqual({ start: 0, end: 6, query: 'derby' })
  })

  it('nothing for a finished word, a `#` after a space, mid-word `#`, `##`, or a selection', () => {
    expect(findTrigger('#derby ', 7)).toBeNull()
    expect(findTrigger('# ', 2)).toBeNull()
    expect(findTrigger('C#', 2)).toBeNull()
    expect(findTrigger('##', 2)).toBeNull()
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

  it('a bare `#` goes on its own', () => {
    expect(removeTrigger('Heja #', { start: 5, end: 6 })).toEqual({ text: 'Heja ', caret: 5 })
    expect(removeTrigger('Heja # nu', { start: 5, end: 6 })).toEqual({ text: 'Heja nu', caret: 5 })
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
  it('a bare `#` opens at once with the latest Stories, nothing active', () => {
    const t = inline()
    t.type('Heja #')
    expect(t.l.open.value).toBe(true)
    expect(t.l.results.value.map(s => s.id)).toEqual(['story-b', 'story-a', 'story-c'])
    expect(t.l.active.value).toBe(-1)
    // Enter is still a new line: nothing is attached without a choice.
    expect(t.l.key('Enter')).toBe(false)
  })

  it('`#` then `#word`: typing narrows the same suggestions and resets the active one', () => {
    const t = inline()
    t.type('#')
    t.l.key('ArrowDown')
    expect(t.l.active.value).toBe(0)
    t.type('d')
    expect([t.l.open.value, t.l.active.value, t.l.results.value.map(s => s.id)]).toEqual([true, -1, ['story-a', 'story-c']])
    t.type('erby')
    expect(t.l.results.value.map(s => s.id)).toEqual(['story-a', 'story-c'])
    t.type(' ')
    expect(t.l.open.value).toBe(false)
    expect(tokenize(t.text)).toContainEqual({ type: 'tag', value: 'derby' })
  })

  it('a bare `#` then a space or Escape closes it; the `#` stays in the text', () => {
    const t = inline()
    t.type('#')
    t.type(' ')
    expect([t.l.open.value, t.text]).toEqual([false, '# '])
    t.type('#')
    expect(t.l.key('Escape')).toBe(true)
    expect([t.l.open.value, t.text]).toEqual([false, '# #'])
    // Typing on after dismissing the bare `#` stays quiet for that word.
    t.type('derb')
    expect(t.l.open.value).toBe(false)
  })

  it('choosing from a bare `#` removes just the `#` and puts the caret there', () => {
    const t = inline()
    t.type('Heja #')
    t.l.key('ArrowDown')
    const picked = t.l.key('Enter') as Story
    expect(t.l.choose(t.text, picked)).toEqual({ text: 'Heja ', caret: 5, storyId: 'story-b' })
  })

  it('moving the caret back into an earlier `#word` reopens it', () => {
    const l = createInlineLookup({ stories: () => STORIES, enabled: () => true })
    const text = '#derby i kväll'
    l.sync(text, text.length)
    expect(l.open.value).toBe(false)
    l.sync(text, 4) // a click or arrow key inside "#derby"
    expect([l.open.value, l.trigger.value?.query]).toEqual([true, 'derby'])
  })

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

  it('no match: the suggestions quietly go, the hashtag and its keys stay untouched', () => {
    const t = inline()
    t.type('#zl')
    expect([t.l.open.value, t.l.results.value]).toEqual([false, []])
    // Nothing unrelated fills the gap, and every key does its usual thing.
    expect(t.l.key('ArrowDown')).toBe(false)
    expect(t.l.key('Enter')).toBe(false)
    expect(t.l.key('Escape')).toBe(false)
    t.type('atan!')
    expect(tokenize(t.text)).toContainEqual({ type: 'tag', value: 'zlatan' })
  })

  it('narrowing to nothing and back: hidden in between, open again on a match', () => {
    const t = inline()
    t.type('#')
    expect(t.l.open.value).toBe(true)
    t.type('k')
    expect(t.l.results.value.map(s => s.id)).toEqual(['story-b', 'story-c'])
    t.type('x')
    expect(t.l.open.value).toBe(false)
    const l = createInlineLookup({ stories: () => STORIES, enabled: () => true })
    l.sync('#klar', 5)
    expect([l.open.value, l.results.value.map(s => s.id)]).toEqual([true, ['story-c']])
  })

  it('no Stories loaded: a bare `#` shows nothing', () => {
    const l = createInlineLookup({ stories: () => [], enabled: () => true })
    l.sync('#', 1)
    expect(l.open.value).toBe(false)
  })

  it('three suggestions at most, for a bare `#` and a query alike', () => {
    const many = Array.from({ length: 9 }, (_, i) => story(`m${i}`, `Rubrik ${i}`, 'Sportbladet', `2026-11-0${i + 1}T10:00:00Z`))
    const l = createInlineLookup({ stories: () => many, enabled: () => true })
    l.sync('#', 1)
    expect(l.results.value.map(s => s.id)).toEqual(['story-m8', 'story-m7', 'story-m6'])
    l.sync('#rubrik', 7)
    expect(l.results.value).toHaveLength(3)
    // "Bifoga" searches the whole list.
    expect(matchStories(many, 'rubrik', 20)).toHaveLength(9)
  })

  it('quiet while a Story is attached: one Story per post, and hashtags stay hashtags', () => {
    const t = inline(true)
    t.type('#')
    expect(t.l.open.value).toBe(false)
    t.type('derb')
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
