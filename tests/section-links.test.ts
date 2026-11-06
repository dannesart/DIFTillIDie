import { describe, expect, it } from 'vitest'
import { sectionLinks, SHELL_BASE } from '../app/lib/sectionLinks'

/*
 * Mission #17: shared components (posts, Stories, the mini-player, the
 * account dialog) work out where sections and supporters live from the
 * current path. Outside the app-shell prototype nothing may change.
 */

describe('outside the prototype (the real site)', () => {
  it('keeps the front page anchors and /laktaren addresses', () => {
    for (const path of ['/', '/laktaren/jarnmannen']) {
      const l = sectionLinks(path)
      expect(l.shell).toBe(false)
      expect(l.section('hem')).toBe('/')
      expect(l.section('snacket')).toBe('/#snacket')
      expect(l.section('stories')).toBe('/#stories')
      expect(l.section('lyssna')).toBe('/#lyssna')
      expect(l.supporter('difvast')).toBe('/laktaren/difvast')
    }
  })

  it('has every section on the front page, and none on a supporter page', () => {
    expect(sectionLinks('/').shows('snacket')).toBe(true)
    expect(sectionLinks('/').shows('stories')).toBe(true)
    expect(sectionLinks('/laktaren/jarnmannen').shows('snacket')).toBe(false)
  })

  it('is not fooled by a path that only starts like the prototype', () => {
    expect(sectionLinks('/prototypen').shell).toBe(false)
  })
})

describe('inside the prototype', () => {
  it('gives each section its own view and keeps supporters inside', () => {
    const l = sectionLinks(`${SHELL_BASE}/stories`)
    expect(l.shell).toBe(true)
    expect(l.section('hem')).toBe('/prototyp')
    expect(l.section('snacket')).toBe('/prototyp/snacket')
    expect(l.supporter('jarnmannen')).toBe('/prototyp/laktaren/jarnmannen')
  })

  it('shows exactly the section of the current view', () => {
    const l = sectionLinks('/prototyp/snacket')
    expect(l.shows('snacket')).toBe(true)
    expect(l.shows('stories')).toBe(false)
    expect(l.shows('hem')).toBe(false)
    expect(sectionLinks('/prototyp').shows('hem')).toBe(true)
    expect(sectionLinks('/prototyp/').shows('hem')).toBe(true)
    expect(sectionLinks('/prototyp/laktaren/difvast').shows('snacket')).toBe(false)
  })
})
