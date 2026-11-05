import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SourceArticle, Story } from '../shared/types/domain'
import { MAX_SOURCES, captureKeyFrom, captureStory, freezeStory, withCaptures } from '../server/lib/capture'
import { articleId, articleKey, legacyArticleId } from '../server/lib/news'
import { findStory, storyAnswersTo } from '../shared/utils/story'

/* What the server signs for a Story, and how references to Stories resolve. */

function art(url: string, extra: Partial<SourceArticle> = {}): SourceArticle {
  return {
    id: articleId('Aftonbladet', url), legacyId: legacyArticleId('Aftonbladet', url), sourceId: 'sportbladet-fotboll', outlet: 'Sportbladet',
    publisher: 'Aftonbladet', headline: `Rubrik ${url}`, url, publishedAt: '2026-11-04T18:00:00.000Z', sport: 'fotboll', reporting: 'original', ...extra,
  }
}
const story = (sources: SourceArticle[], leadId = sources[0]!.id): Story =>
  ({ id: `story-${sources[0]!.id}`, sport: 'fotboll', sources, leadId, sharedNames: ['Rosenqvist'], updatedAt: '2026-11-04T19:00:00.000Z' })
const KEY = { kid: 'k1', secret: 's3cret' }

describe('the capture of a Story', () => {
  const a = art('https://e.se/a', { excerpt: 'Ingressen ska inte sparas.' })
  const b = art('https://e.se/b?utm_source=rss', { sourceId: 'expressen-fotboll', outlet: 'Expressen', publisher: 'Expressen' })

  it('keeps each source’s own headline, publisher, URL and dates, and when our server read its feed', () => {
    const f = freezeStory(story([a, b], b.id), 'k1', [{ id: 'sportbladet-fotboll', fetchedAt: '2026-11-04T18:05:00.000Z' }])
    expect(f).toMatchObject({ v: 1, kid: 'k1', storyId: `story-${a.id}`, leadKey: articleKey(b.url) })
    expect(f.sources).toEqual([
      { key: articleKey(a.url), id: a.id, legacyId: a.legacyId, sourceId: 'sportbladet-fotboll', outlet: 'Sportbladet', publisher: 'Aftonbladet', headline: a.headline, url: a.url, publishedAt: a.publishedAt, capturedAt: '2026-11-04T18:05:00.000Z', reporting: 'original', sport: 'fotboll' },
      // Unknown feed time: null, not a guess. The URL is kept exactly as the feed gave it.
      expect.objectContaining({ outlet: 'Expressen', url: 'https://e.se/b?utm_source=rss', key: articleKey('https://e.se/b'), capturedAt: null }),
    ])
  })

  it('never copies article text: no teaser, no grouping notes', () => {
    const data = captureStory(story([a]), KEY, []).data
    expect(data).not.toContain('Ingressen')
    expect(data).not.toContain('Rosenqvist')
  })

  it('is signed over the exact JSON sent', () => {
    const c = captureStory(story([a, b]), KEY, [])
    expect(c.sig).toBe(createHmac('sha256', 's3cret').update(c.data).digest('hex'))
    expect(JSON.parse(c.data).sources).toHaveLength(2)
  })

  it('a handful of sources at most', () => {
    const many = Array.from({ length: 25 }, (_, i) => art(`https://e.se/${i}`))
    expect(freezeStory(story(many), 'k1', []).sources).toHaveLength(MAX_SOURCES)
  })

  it('the lead is always among them, even beyond the limit (regression)', () => {
    const many = Array.from({ length: 25 }, (_, i) => art(`https://e.se/${i}`))
    for (const leadAt of [0, 19, 20, 24]) {
      const f = freezeStory(story(many, many[leadAt]!.id), 'k1', [])
      expect(f.sources).toHaveLength(MAX_SOURCES)
      expect(f.sources.filter(s => s.key === f.leadKey).map(s => s.id), `lead at ${leadAt}`).toEqual([many[leadAt]!.id])
      // Otherwise the Story's own order, oldest first, without duplicates.
      expect(new Set(f.sources.map(s => s.key)).size).toBe(MAX_SOURCES)
    }
    const f = freezeStory(story(many, many[24]!.id), 'k1', [])
    expect(f.sources.map(s => s.id)).toEqual([...many.slice(0, 19), many[24]!].map(a => a.id))
  })

  it('no key: no captures, so nothing can be attached as if it were verified', () => {
    expect(withCaptures([story([a])], null, [])[0]!.capture).toBeUndefined()
    expect(withCaptures([story([a])], KEY, [])[0]!.capture?.sig).toMatch(/^[0-9a-f]{64}$/)
    expect(captureKeyFrom({ keyId: '', key: 'x' })).toBeNull()
    expect(captureKeyFrom({ keyId: 'k', key: '' })).toBeNull()
    expect(captureKeyFrom({ keyId: 'k', key: 'x' })).toEqual({ kid: 'k', secret: 'x' })
  })
})

describe('article identity', () => {
  it('the durable key is SHA-256 of the canonical URL; the id carries 96 bits of it', () => {
    const url = 'https://www.aftonbladet.se/sportbladet/fotboll/a/eGj2Rg/x'
    expect(articleKey(`${url}?utm_medium=rss`)).toBe(articleKey(url))
    expect(articleKey(url)).toMatch(/^[0-9a-f]{64}$/)
    expect(articleId('Aftonbladet', url)).toBe(`aftonbladet-${articleKey(url).slice(0, 24)}`)
  })

  it('the legacy 32-bit id is still computed the old way, for older posts', () => {
    // Pinned: posts in the database refer to Stories by this exact value.
    // (Checked against the articleId() of commit 25e3974.)
    expect(legacyArticleId('Aftonbladet', 'https://www.aftonbladet.se/sportbladet/fotboll/a/eGj2Rg/x?utm_medium=rss')).toBe('aftonbladet-1r54dbw')
    expect(legacyArticleId('Aftonbladet', 'https://e.se/a')).toBe(legacyArticleId('Aftonbladet', 'https://e.se/a?utm_source=x'))
  })
})

describe('finding the Story a post refers to', () => {
  const a = art('https://e.se/a')
  const b = art('https://e.se/b')
  const stories = [story([a]), story([b])]

  it('by the current id, of any of its articles', () => {
    expect(findStory(stories, `story-${b.id}`)).toBe(stories[1])
    expect(findStory(stories, undefined)).toBeUndefined()
  })

  it('by a legacy id, when exactly one Story answers to it', () => {
    expect(findStory(stories, `story-${a.legacyId}`)).toBe(stories[0])
  })

  it('a legacy id two live Stories share (a 32-bit collision) is ambiguous: nothing, never a guess', () => {
    const clash = [story([{ ...a, legacyId: 'aftonbladet-same' }]), story([{ ...b, legacyId: 'aftonbladet-same' }])]
    expect(clash.every(s => storyAnswersTo(s, 'story-aftonbladet-same'))).toBe(true)
    expect(findStory(clash, 'story-aftonbladet-same')).toBeUndefined()
  })

  it('a current id always wins over a legacy coincidence', () => {
    const tricky = [story([{ ...a, legacyId: b.id }]), story([b])]
    expect(findStory(tricky, `story-${b.id}`)).toBe(tricky[1])
  })
})
