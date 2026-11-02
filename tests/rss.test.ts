import { describe, expect, it } from 'vitest'
import { FeedError, decodeEntities, fetchFeed, parseRss, toPlainText } from '../server/lib/rss'
import { fakeFetch, fixture } from './helpers'

describe('parseRss', () => {
  it('parses the Bollsvenskan team feed, including its <teams> tag and CDATA teasers', () => {
    const ch = parseRss(fixture('bollsvenskan'))
    expect(ch.items).toHaveLength(8)
    const item = ch.items.find(i => i.title.startsWith('VAR-krav'))!
    expect(item.link).toBe('https://bollsvenskan.se/nyhetsflode/?post_id=5c57d1f2-f3d4-aa2c-7b35-d2a53a1a8ce2')
    expect(item.teams).toEqual(['Degerfors IF', 'Djurgårdens IF'])
    expect(item.description).toMatch(/^Nekad frispark på Nikolai Skuseth/)
    expect(item.description).toMatch(/…$/) // &hellip; inside CDATA is decoded
  })

  it('decodes numeric entities in titles', () => {
    const ch = parseRss(fixture('bollsvenskan'))
    expect(ch.items.some(i => i.title.includes('“Det handlar enbart om mentalitet'))).toBe(true)
  })

  it('parses podcast enclosures and durations', () => {
    const ch = parseRss(fixture('djurgarnbynight'))
    expect(ch.title).toBe('Djurgårn by night')
    expect(ch.items[0]!.enclosure).toEqual({ url: 'https://media.pod.space/djurgarnbynight/recording-16_261028.mp3', type: 'audio/mpeg' })
    expect(ch.items[0]!.duration).toBe('00:35:30')
  })

  it('accepts an empty channel', () => {
    expect(parseRss('<?xml version="1.0"?><rss version="2.0"><channel><title>Tomt</title></channel></rss>').items).toEqual([])
  })

  it('rejects things that are not RSS', () => {
    expect(() => parseRss('<!doctype html><html><body>Oops</body></html>')).toThrow(FeedError)
    expect(() => parseRss('')).toThrow(FeedError)
    expect(() => parseRss('<rss><nochannel/></rss>')).toThrow(/channel/)
  })
})

describe('text helpers', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('A &amp; B &#8220;C&#8221; &hellip; &#x2013;')).toBe('A & B “C” … –')
  })

  it('turns HTML into plain text with paragraph breaks', () => {
    expect(toPlainText('<p>Ett&nbsp;två</p><p></p><p><a href="x">Länk</a></p>')).toBe('Ett två\nLänk')
  })
})

describe('fetchFeed failures', () => {
  it('reports HTTP errors', async () => {
    await expect(fetchFeed('https://x.test/feed', { fetcher: fakeFetch('nope', { status: 503 }) })).rejects.toThrow('HTTP 503')
  })

  it('reports a timeout when the publisher hangs', async () => {
    const hanging: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })
    await expect(fetchFeed('https://x.test/feed', { fetcher: hanging, timeoutMs: 50 })).rejects.toThrow('Tidsgräns (50 ms)')
  })

  it('reports network errors', async () => {
    const broken: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(fetchFeed('https://x.test/feed', { fetcher: broken })).rejects.toThrow('Nätverksfel: fetch failed')
  })

  it('reports a 200 response that is an HTML page, not a feed', async () => {
    await expect(fetchFeed('https://x.test/feed', { fetcher: fakeFetch('<html>Cookie wall</html>') })).rejects.toThrow(FeedError)
  })
})
