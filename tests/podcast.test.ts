import { describe, expect, it } from 'vitest'
import type { PodcastResponse } from '../shared/types/domain'
import { loadPodcast, parseDuration, toEpisodes } from '../server/lib/podcast'
import { parseRss } from '../server/lib/rss'
import { fakeFetch, fixture } from './helpers'

describe('toEpisodes', () => {
  const { show, episodes } = toEpisodes(parseRss(fixture('djurgarnbynight')))

  it('maps the show and its episodes', () => {
    expect(show).toMatchObject({ title: 'Djurgårn by night', url: 'https://pod.space/djurgarnbynight', copyright: 'Splitstone productions AB' })
    expect(episodes[0]).toMatchObject({
      title: 'Avskedsansökan',
      publishedAt: '2026-10-28T21:02:26.000Z',
      url: 'https://pod.space/djurgarnbynight/avskedsansokan',
      audioUrl: 'https://media.pod.space/djurgarnbynight/recording-16_261028.mp3',
      durationSeconds: 35 * 60 + 30,
    })
  })

  it('keeps only the first paragraph of the show notes', () => {
    expect(episodes[0]!.excerpt).toBe('Det ville sig inte när Djurgårn bara ville stundtals. Matchplanen, Ninos utskjutning, puls och historiska icke-mål.')
  })

  it('only hands https audio enclosures to the player', () => {
    const xml = (url: string, type: string) => `<rss version="2.0"><channel><title>x</title><item><title>E</title><link>https://x.test/e</link><pubDate>Wed, 28 Oct 2026 21:02:26 +0000</pubDate><enclosure url="${url}" type="${type}"/></item></channel></rss>`
    expect(toEpisodes(parseRss(xml('http://x.test/a.mp3', 'audio/mpeg'))).episodes[0]!.audioUrl).toBeUndefined()
    expect(toEpisodes(parseRss(xml('https://x.test/a.mp4', 'video/mp4'))).episodes[0]!.audioUrl).toBeUndefined()
    expect(toEpisodes(parseRss(xml('https://x.test/a.mp3', 'audio/mpeg'))).episodes[0]!.audioUrl).toBe('https://x.test/a.mp3')
  })
})

describe('parseDuration', () => {
  it('handles hh:mm:ss, mm:ss and seconds', () => {
    expect(parseDuration('01:02:03')).toBe(3723)
    expect(parseDuration('35:30')).toBe(2130)
    expect(parseDuration('2130')).toBe(2130)
    expect(parseDuration('n/a')).toBeUndefined()
  })
})

describe('loadPodcast', () => {
  it('reports failure without episodes when the feed is down and nothing was fetched before', async () => {
    const r = await loadPodcast({ lastGood: {}, fetcher: fakeFetch('', { status: 502 }) })
    expect(r).toMatchObject({ show: null, episodes: [], status: { ok: false, stale: false, error: 'HTTP 502' } })
  })

  it('serves the last good episodes, marked stale, after a failure', async () => {
    const lastGood: { value?: PodcastResponse } = {}
    await loadPodcast({ lastGood, fetcher: fakeFetch(fixture('djurgarnbynight')) })
    const r = await loadPodcast({ lastGood, fetcher: fakeFetch('', { status: 502 }) })
    expect(r.episodes).toHaveLength(2)
    expect(r.status).toMatchObject({ ok: false, stale: true })
  })
})
