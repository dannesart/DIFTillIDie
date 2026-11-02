import { describe, expect, it } from 'vitest'
import { NEWS_SOURCES, toSourceArticles } from '../server/lib/news'
import { PODCAST_SHOWS, toEpisodes } from '../server/lib/podcast'
import { fetchFeed } from '../server/lib/rss'
import { DIF_CALENDAR, fixturesFromIcs } from '../server/lib/fixtures'

/*
 * Talks to the real publishers. Run with `npm run test:live`.
 * Skipped in `npm test` so the unit suite never depends on the network.
 */
const live = process.env.npm_lifecycle_event === 'test:live' || !!process.env.LIVE
const FOURTEEN_DAYS = 14 * 24 * 3_600_000

describe.runIf(live)('live feeds', () => {
  for (const source of NEWS_SOURCES) {
    it(`${source.id} is reachable and current`, async () => {
      const channel = await fetchFeed(source.feedUrl, { timeoutMs: 15_000 })
      expect(channel.items.length).toBeGreaterThan(0)
      const newest = Math.max(...channel.items.map(i => Date.parse(i.pubDate ?? '')).filter(Number.isFinite))
      expect(Date.now() - newest).toBeLessThan(FOURTEEN_DAYS)
      const { articles } = toSourceArticles(source, channel)
      // Broad feeds may legitimately have no Djurgården item right now; report it rather than fail.
      console.info(`${source.id}: ${channel.items.length} items, ${articles.length} about Djurgården`)
      for (const a of articles) expect(a.url).toMatch(/^https:\/\//)
    }, 20_000)
  }

  for (const team of ['herrar', 'damer'] as const) {
    it(`dif.se match calendar (${team}) is reachable and parses`, async () => {
      const res = await fetch(DIF_CALENDAR.url(team), { signal: AbortSignal.timeout(15_000) })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/calendar/)
      const { fixtures, eventCount } = fixturesFromIcs(await res.text(), team)
      expect(eventCount).toBeGreaterThan(0)
      const upcoming = fixtures.filter(f => Date.parse(f.kickoff) > Date.now())
      // Off-season may legitimately have none; report rather than fail.
      console.info(`${team}: ${eventCount} events, ${fixtures.length} first-team, ${upcoming.length} upcoming`)
    }, 20_000)
  }

  for (const show of PODCAST_SHOWS) {
    it(`${show.id} has a recent episode with playable audio`, async () => {
      const { episodes } = toEpisodes(await fetchFeed(show.feedUrl, { timeoutMs: 15_000 }), show)
      const latest = episodes[0]!
      expect(Date.now() - Date.parse(latest.publishedAt)).toBeLessThan(60 * 24 * 3_600_000)
      expect(latest.audioUrl).toBeTruthy()
      const res = await fetch(latest.audioUrl!, { headers: { range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15_000) })
      expect([200, 206]).toContain(res.status)
      expect(res.headers.get('content-type')).toMatch(/^audio\//)
      await res.body?.cancel()
      console.info(`${show.id}: "${latest.title}" (${latest.publishedAt.slice(0, 10)})`)
    }, 30_000)
  }
})
