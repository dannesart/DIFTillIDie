import { describe, expect, it } from 'vitest'
import type { PodcastResponse } from '../shared/types/domain'
import { PODCAST_SHOWS, loadPodcast, loadPodcasts, parseDuration, toEpisodes } from '../server/lib/podcast'
import { parseRss } from '../server/lib/rss'
import { fakeFetch, fixture } from './helpers'

const show = (id: string) => PODCAST_SHOWS.find(s => s.id === id)!
const byNight = show('djurgarnbynight')
const snack = show('blarandigtsnack')

describe('Djurgårn by night', () => {
  const { show: info, episodes } = toEpisodes(parseRss(fixture('djurgarnbynight')), byNight)

  it('maps the show and its episodes', () => {
    expect(info).toMatchObject({ title: 'Djurgårn by night', url: 'https://pod.space/djurgarnbynight', copyright: 'Splitstone productions AB' })
    expect(episodes[0]).toMatchObject({
      id: 'djurgarnbynight:e5a2a033-b39a-455f-b9c0-8e10bfe49704',
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
})

describe('Blårandigt Snack', () => {
  const { show: info, episodes } = toEpisodes(parseRss(fixture('blarandigtsnack')), snack)

  it('maps real episodes with playable audio', () => {
    expect(episodes).toHaveLength(2)
    expect(episodes[0]).toMatchObject({
      title: 'Summering Djurgården mot Göteborg och Degerfors',
      publishedAt: '2026-11-01T21:23:06.000Z',
      url: 'https://shows.acast.com/blarandigt-sn/episodes/6ae7adba339f23a726605037',
      audioUrl: 'https://sphinx.acast.com/p/open/s/68d05bae2cf15c8db006caa8/e/6ae7adba339f23a726605037/media.mp3',
      durationSeconds: 69 * 60 + 30,
    })
    expect(episodes[0]!.id).toMatch(/^blarandigtsnack:/)
  })

  it('links attribution to the show page, not the feed URL in <link>', () => {
    expect(info).toMatchObject({ title: 'Blårandigt Snack', url: 'https://shows.acast.com/blarandigt-sn' })
  })

  it('strips the hosting platform boilerplate from show notes', () => {
    expect(episodes[1]!.excerpt).toBe('Ny match och denna gång är det IFK Göteborg som står för motståndet. Vi snackar upp matchen och går igenom vad som måste förbättras från besvikelsen mot Örgryte.')
    for (const e of episodes) expect(e.excerpt).not.toMatch(/acast/i)
  })

  it('carries the show’s listening links and welcome', async () => {
    const r = await loadPodcast(snack, { lastGood: new Map(), fetcher: fakeFetch(fixture('blarandigtsnack')) })
    expect(r).toMatchObject({ id: 'blarandigtsnack', cover: 'snack', hosts: 'Cosmos & Victor', newcomer: true })
    expect(r.links.map(l => l.url)).toEqual([
      'https://open.spotify.com/show/3XyDBlO7iMHrkXPemp4GWc',
      'https://poddtoppen.se/podcast/1845931235/blarandigt-snack',
      'https://shows.acast.com/blarandigt-sn',
    ])
  })
})

describe('episode audio', () => {
  it('only hands https audio enclosures to the player', () => {
    const xml = (url: string, type: string) => `<rss version="2.0"><channel><title>x</title><item><title>E</title><link>https://x.test/e</link><pubDate>Wed, 28 Oct 2026 21:02:26 +0000</pubDate><enclosure url="${url}" type="${type}"/></item></channel></rss>`
    expect(toEpisodes(parseRss(xml('http://x.test/a.mp3', 'audio/mpeg')), snack).episodes[0]!.audioUrl).toBeUndefined()
    expect(toEpisodes(parseRss(xml('https://x.test/a.mp4', 'video/mp4')), snack).episodes[0]!.audioUrl).toBeUndefined()
    expect(toEpisodes(parseRss(xml('https://x.test/a.mp3', 'audio/mpeg')), snack).episodes[0]!.audioUrl).toBe('https://x.test/a.mp3')
  })

  it('never gives two shows the same episode id', () => {
    const a = toEpisodes(parseRss(fixture('djurgarnbynight')), byNight).episodes
    const b = toEpisodes(parseRss(fixture('blarandigtsnack')), snack).episodes
    const ids = [...a, ...b].map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('parseDuration', () => {
  it('handles hh:mm:ss, mm:ss and seconds', () => {
    expect(parseDuration('01:02:03')).toBe(3723)
    expect(parseDuration('1:09:30')).toBe(4170)
    expect(parseDuration('35:30')).toBe(2130)
    expect(parseDuration('2130')).toBe(2130)
    expect(parseDuration('n/a')).toBeUndefined()
  })
})

describe('loading shows', () => {
  it('reports failure honestly, with listening links, when a feed is down and nothing was fetched before', async () => {
    const r = await loadPodcast(snack, { lastGood: new Map(), fetcher: fakeFetch('', { status: 502 }) })
    expect(r).toMatchObject({ episodes: [], status: { ok: false, stale: false, error: 'HTTP 502' }, show: { title: 'Blårandigt Snack', url: 'https://shows.acast.com/blarandigt-sn' } })
    expect(r.links.length).toBeGreaterThan(0)
  })

  it('serves the last good episodes, marked stale, after a failure', async () => {
    const lastGood = new Map<string, PodcastResponse>()
    await loadPodcast(byNight, { lastGood, fetcher: fakeFetch(fixture('djurgarnbynight')) })
    const r = await loadPodcast(byNight, { lastGood, fetcher: fakeFetch('', { status: 502 }) })
    expect(r.episodes).toHaveLength(2)
    expect(r.status).toMatchObject({ ok: false, stale: true })
  })

  it('loads every show independently: one failing feed never hides the other', async () => {
    const fetcher: typeof fetch = async url => String(url).includes('acast')
      ? new Response(fixture('blarandigtsnack'))
      : new Response('', { status: 503 })
    const { shows } = await loadPodcasts({ lastGood: new Map(), fetcher })
    expect(shows.map(s => [s.id, s.status.ok, s.episodes.length])).toEqual([
      ['djurgarnbynight', false, 0],
      ['blarandigtsnack', true, 2],
    ])
  })
})
