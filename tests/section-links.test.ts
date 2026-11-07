import { describe, expect, it } from 'vitest'
import { desktopTarget, sectionLinks, SHELL_BASE } from '../app/lib/sectionLinks'

/*
 * Mission #17: shared components (posts, Stories, the mini-player, the
 * account dialog) work out where sections and supporters live from the
 * current path. With the shell switched off nothing may change.
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

  it("sends a post's Story to the front page, and is not a shell even on desktop", () => {
    const l = sectionLinks('/laktaren/jarnmannen', { desktop: () => true })
    expect(l.story('story-1')).toBe('/#story-1')
    expect(l.shell).toBe(false)
    expect(sectionLinks('/', { desktop: () => true }).shows('snacket')).toBe(true)
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

describe('with the app shell switched on (APP_SHELL=1)', () => {
  const phone = { shell: true, desktop: () => false }
  const desktop = { shell: true, desktop: () => true }

  it('keeps the classic links, which work on every screen size', () => {
    for (const path of ['/', '/snacket', '/laktaren/jarnmannen']) {
      const l = sectionLinks(path, desktop)
      expect(l.shell).toBe(true)
      expect(l.prototype).toBe(false)
      expect(l.section('snacket')).toBe('/#snacket')
      expect(l.section('hem')).toBe('/')
      expect(l.story('story-1')).toBe('/#story-1')
      expect(l.supporter('difvast')).toBe('/laktaren/difvast')
    }
  })

  it('gives the sidebar the views, and knows which one it is on by address alone', () => {
    const l = sectionLinks('/stories/', phone)
    expect(l.view('stories')).toBe('/stories')
    expect(l.view('hem')).toBe('/')
    expect(l.here('stories')).toBe(true)
    expect(l.here('snacket')).toBe(false)
    expect(sectionLinks('/', phone).here('hem')).toBe(true)
    expect(sectionLinks('/', phone).here('snacket')).toBe(false)
  })

  it("has every section on a phone's front page, and only Hem on desktop's", () => {
    expect(sectionLinks('/', phone).shows('snacket')).toBe(true)
    expect(sectionLinks('/', phone).shows('lyssna')).toBe(true)
    expect(sectionLinks('/', desktop).shows('snacket')).toBe(false)
    expect(sectionLinks('/', desktop).shows('hem')).toBe(true)
    expect(sectionLinks('/snacket', desktop).shows('snacket')).toBe(true)
    expect(sectionLinks('/laktaren/difvast', desktop).shows('snacket')).toBe(false)
  })

  it('asks for the screen size only when asked what is shown', () => {
    let asked = 0
    const l = sectionLinks('/', { shell: true, desktop: () => (asked++, true) })
    l.section('snacket'); l.view('snacket'); l.here('snacket'); l.story('story-1')
    expect(asked).toBe(0)
    l.shows('snacket')
    expect(asked).toBe(1)
  })
})

describe('classic links followed on a desktop with the shell', () => {
  it("turn the front page's sections into their views", () => {
    expect(desktopTarget('/', '#snacket')).toEqual({ path: '/snacket' })
    expect(desktopTarget('/', '#stories')).toEqual({ path: '/stories' })
    expect(desktopTarget('/', '#lyssna')).toEqual({ path: '/lyssna' })
  })

  it('take a Story or a post along to its view', () => {
    expect(desktopTarget('/', '#story-abc')).toEqual({ path: '/stories', hash: '#story-abc' })
    expect(desktopTarget('/', '#post-1')).toEqual({ path: '/snacket', hash: '#post-1' })
  })

  it('leave everything else alone', () => {
    expect(desktopTarget('/', '')).toBeNull()
    expect(desktopTarget('/', '#hem')).toBeNull()
    expect(desktopTarget('/', '#innehall')).toBeNull()
    expect(desktopTarget('/laktaren/difvast', '#snacket')).toBeNull()
    expect(desktopTarget('/snacket', '#post-1')).toBeNull()
  })
})
