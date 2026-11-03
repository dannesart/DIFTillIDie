import { describe, expect, it } from 'vitest'
import { createComposerOpen, focusDestination } from '../app/lib/composerState'

/*
 * The post composer's open/closed state. Regression for: focusing an empty
 * composer, then clicking "Koppla till en Story…" collapsed it before the
 * Story could be chosen (expansion used to follow textarea focus).
 */

function composer() {
  const draft = { body: '', storyId: '', error: null as string | null }
  const c = createComposerOpen(() => !draft.body.trim() && !draft.storyId && !draft.error)
  return { draft, c }
}

describe('choosing a Story before typing', () => {
  it('focus moving from the textarea to the Story select keeps it open', () => {
    const { c } = composer()
    c.enter() // textarea focused
    c.leave('inside') // focus moves to the <select>
    c.enter()
    expect(c.open.value).toBe(true)
  })

  it('after choosing, the Story stays attached and the composer open — even when the select removes itself', () => {
    const { draft, c } = composer()
    c.enter()
    c.leave('inside')
    c.enter()
    draft.storyId = 'story-x' // the select is replaced by the attached-Story chip
    c.leave('nowhere') // the focused <select> left the DOM
    expect(c.open.value).toBe(true)
    // Not pristine any more: even moving focus outside keeps it open.
    c.leave('outside')
    expect([c.open.value, draft.storyId]).toEqual([true, 'story-x'])
  })
})

describe('the composer’s own controls never collapse it', () => {
  it('sport chips: focus may go to the chip, or nowhere (Safari doesn’t focus buttons)', () => {
    const { c } = composer()
    c.enter()
    c.leave('inside')
    expect(c.open.value).toBe(true)
    c.leave('nowhere')
    expect(c.open.value).toBe(true)
  })

  it('a click on a non-focusable part of the composer or page keeps it open', () => {
    const { c } = composer()
    c.enter()
    c.leave('nowhere')
    expect(c.open.value).toBe(true)
  })
})

describe('closing', () => {
  it('an untouched composer closes when focus moves to something else on the page', () => {
    const { c } = composer()
    c.enter()
    c.leave('outside')
    expect(c.open.value).toBe(false)
  })

  it('with text or an error it stays open, so nothing typed or reported disappears', () => {
    const { draft, c } = composer()
    c.enter()
    draft.body = 'Heja'
    c.leave('outside')
    expect(c.open.value).toBe(true)
    draft.body = ''
    draft.error = 'Ingen kontakt med servern.'
    c.leave('outside')
    expect(c.open.value).toBe(true)
  })

  it('Escape closes an untouched composer, but not one with something in it', () => {
    const { draft, c } = composer()
    c.enter()
    draft.body = 'Heja'
    expect(c.escape()).toBe(false)
    expect(c.open.value).toBe(true)
    draft.body = ''
    expect(c.escape()).toBe(true)
    expect(c.open.value).toBe(false)
  })

  it('publishing resets it to closed, and it opens again on the next focus', () => {
    const { draft, c } = composer()
    c.enter()
    draft.storyId = 'story-x'
    draft.body = 'Mål!'
    // published: the component clears body and Story, then resets
    draft.body = ''
    draft.storyId = ''
    c.reset()
    expect(c.open.value).toBe(false)
    c.leave('nowhere') // the hidden control losing focus changes nothing
    expect(c.open.value).toBe(false)
    c.enter()
    expect(c.open.value).toBe(true)
  })
})

describe('where focus went', () => {
  const inside = { id: 'select' }
  const form = { contains: (n: unknown) => n === inside }
  it('classifies a focusout by its relatedTarget', () => {
    expect(focusDestination(form, null)).toBe('nowhere')
    expect(focusDestination(form, inside as unknown as EventTarget)).toBe('inside')
    expect(focusDestination(form, { id: 'elsewhere' } as unknown as EventTarget)).toBe('outside')
    expect(focusDestination(null, { id: 'x' } as unknown as EventTarget)).toBe('outside')
  })
})
