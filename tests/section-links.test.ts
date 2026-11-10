import { describe, expect, it } from 'vitest'
import { legacyTarget, sectionLinks } from '../app/lib/sectionLinks'

/*
 * Shared components (posts, Stories, the mini-player, the bottom nav, the
 * account dialog) work out where sections and supporters live from the
 * current path alone: every section is a page of its own, on every screen
 * size (Issue #16).
 */

describe('section and supporter links', () => {
  it('lead to the pages, from wherever you are', () => {
    for (const path of ['/', '/snacket', '/laktaren/jarnmannen']) {
      const l = sectionLinks(path)
      expect(l.section('hem')).toBe('/')
      expect(l.section('snacket')).toBe('/snacket')
      expect(l.section('stories')).toBe('/stories')
      expect(l.section('lyssna')).toBe('/lyssna')
      expect(l.view('lyssna')).toBe('/lyssna')
      expect(l.story('story-1')).toBe('/stories#story-1')
      expect(l.post('p1')).toBe('/snacket#post-p1')
      expect(l.supporter('difvast')).toBe('/laktaren/difvast')
    }
  })

  it('know which page they are on by address alone', () => {
    const l = sectionLinks('/stories/')
    expect(l.here('stories')).toBe(true)
    expect(l.here('snacket')).toBe(false)
    expect(sectionLinks('/').here('hem')).toBe(true)
    expect(sectionLinks('/').here('snacket')).toBe(false)
    expect(sectionLinks('/snacketen').here('snacket')).toBe(false)
    expect(sectionLinks('/laktaren/difvast').here('hem')).toBe(false)
  })

  it('show a section only on its own page: Hem previews, it does not contain them', () => {
    expect(sectionLinks('/').shows('hem')).toBe(true)
    expect(sectionLinks('/').shows('snacket')).toBe(false)
    expect(sectionLinks('/').shows('lyssna')).toBe(false)
    expect(sectionLinks('/snacket').shows('snacket')).toBe(true)
    expect(sectionLinks('/laktaren/difvast').shows('snacket')).toBe(false)
  })
})

describe('old addresses of the one-page front page', () => {
  it('go to the pages', () => {
    expect(legacyTarget('/', '#snacket')).toEqual({ path: '/snacket' })
    expect(legacyTarget('/', '#stories')).toEqual({ path: '/stories' })
    expect(legacyTarget('/', '#lyssna')).toEqual({ path: '/lyssna' })
    expect(legacyTarget('/', '#hem')).toEqual({ path: '/' })
  })

  it('take a Story or a post along to its page', () => {
    expect(legacyTarget('/', '#story-abc')).toEqual({ path: '/stories', hash: '#story-abc' })
    expect(legacyTarget('/', '#post-1')).toEqual({ path: '/snacket', hash: '#post-1' })
  })

  it('leave everything else alone, so a redirect never redirects again', () => {
    expect(legacyTarget('/', '')).toBeNull()
    expect(legacyTarget('/', '#innehall')).toBeNull()
    expect(legacyTarget('/laktaren/difvast', '#snacket')).toBeNull()
    for (const id of ['#snacket', '#stories', '#lyssna', '#hem', '#story-abc', '#post-1']) {
      const t = legacyTarget('/', id)!
      expect(legacyTarget(t.path, t.hash ?? '')).toBeNull()
    }
  })
})
