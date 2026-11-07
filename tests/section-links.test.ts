import { describe, expect, it } from 'vitest'
import { desktopTarget, sectionLinks } from '../app/lib/sectionLinks'

/*
 * Mission #17: shared components (posts, Stories, the mini-player, the
 * account dialog) work out where sections and supporters live from the
 * current path, and, when a link is followed, the screen size.
 */

describe('section and supporter links', () => {
  const phone = { desktop: () => false }
  const desktop = { desktop: () => true }

  it('keeps the classic links, which work on every screen size', () => {
    for (const path of ['/', '/snacket', '/laktaren/jarnmannen']) {
      for (const screen of [phone, desktop]) {
        const l = sectionLinks(path, screen)
        expect(l.section('hem')).toBe('/')
        expect(l.section('snacket')).toBe('/#snacket')
        expect(l.section('stories')).toBe('/#stories')
        expect(l.section('lyssna')).toBe('/#lyssna')
        expect(l.story('story-1')).toBe('/#story-1')
        expect(l.supporter('difvast')).toBe('/laktaren/difvast')
      }
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
    expect(sectionLinks('/snacketen', phone).here('snacket')).toBe(false)
  })

  it("has every section on a phone's front page, and only Hem on desktop's", () => {
    expect(sectionLinks('/', phone).shows('snacket')).toBe(true)
    expect(sectionLinks('/', phone).shows('lyssna')).toBe(true)
    expect(sectionLinks('/laktaren/difvast', phone).shows('snacket')).toBe(false)
    expect(sectionLinks('/', desktop).shows('snacket')).toBe(false)
    expect(sectionLinks('/', desktop).shows('hem')).toBe(true)
    expect(sectionLinks('/snacket', desktop).shows('snacket')).toBe(true)
    expect(sectionLinks('/laktaren/difvast', desktop).shows('snacket')).toBe(false)
  })

  it('asks for the screen size only when asked what is shown', () => {
    let asked = 0
    const l = sectionLinks('/', { desktop: () => (asked++, true) })
    l.section('snacket'); l.view('snacket'); l.here('snacket'); l.story('story-1')
    expect(asked).toBe(0)
    l.shows('snacket')
    expect(asked).toBe(1)
  })
})

describe('classic links followed on a desktop', () => {
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
