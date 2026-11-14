import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NewsSource } from '../server/lib/news'
import { NEWS_SOURCES, loadSource } from '../server/lib/news'
import { EXIT, RUNS, minutesLate, runCapture } from '../scripts/grouping-eval/captureCore'

/*
 * The daily evidence capture (Issue #25), on a temporary folder with fake feeds: no network, no real data.
 */

const rss = (title: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
  <item><title>${title}</title><link>https://example.com/${encodeURIComponent(title)}</link><description>Djurgården i fokus.</description><pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`
const fetcher = (failing: string[] = []): typeof fetch => (async (url: string | URL | Request) => {
  if (failing.some(f => String(url).includes(f))) throw new Error('simulated network failure')
  return new Response(rss(`Djurgården vinner ${String(url).length}`), { status: 200, headers: { 'content-type': 'application/rss+xml' } })
}) as typeof fetch
const load = (failing: string[] = []) => (s: NewsSource) => loadSource(s, { lastGood: new Map(), fetcher: fetcher(failing) })
const dir = () => mkdtempSync(join(tmpdir(), 'capture-'))
const runs = (root: string) => readFileSync(join(root, RUNS), 'utf8').trim().split('\n').map(l => JSON.parse(l))
const snapshots = (root: string) => readdirSync(join(root, 'snapshots'))
const at = (iso: string) => () => new Date(iso)

describe('daily evidence capture', () => {
  it('a full capture: a snapshot marked complete, and a run record with every source', async () => {
    const root = dir()
    const r = await runCapture({ root, sources: NEWS_SOURCES, load: load(), now: at('2026-11-14T14:40:00Z'), scheduledLocalTime: '15:40' })
    expect(r.status).toBe('success')
    expect(r.exitCode).toBe(EXIT.success)
    expect(r.trigger).toBe('scheduled')
    expect(r.sources.map(s => s.id)).toEqual(NEWS_SOURCES.map(s => s.id))
    const snap = JSON.parse(readFileSync(join(root, 'snapshots', r.snapshot!), 'utf8'))
    expect(snap.capture).toMatchObject({ status: 'success', complete: true })
    expect(snap.articles.length).toBe(r.articleCount)
    expect(runs(root)).toHaveLength(1)
    expect(existsSync(join(root, 'capture.lock'))).toBe(false)
  })

  it('a source failing: partial, never success, and the snapshot says it is incomplete', async () => {
    const root = dir()
    const failing = NEWS_SOURCES[0]!.feedUrl
    const r = await runCapture({ root, sources: NEWS_SOURCES, load: load([failing]) })
    expect(r.status).toBe('partial')
    expect(r.exitCode).toBe(EXIT.partial)
    expect(r.sources.find(s => s.id === NEWS_SOURCES[0]!.id)).toMatchObject({ ok: false, error: expect.stringContaining('simulated') })
    expect(JSON.parse(readFileSync(join(root, 'snapshots', r.snapshot!), 'utf8')).capture).toMatchObject({ status: 'partial', complete: false })
  })

  it('every source failing: failure, and no snapshot', async () => {
    const root = dir()
    const r = await runCapture({ root, sources: NEWS_SOURCES, load: load(NEWS_SOURCES.map(s => s.feedUrl)) })
    expect(r.status).toBe('failure')
    expect(r.exitCode).toBe(EXIT.failure)
    expect(r.snapshot).toBeNull()
    expect(snapshots(root)).toEqual([])
    expect(runs(root)[0].status).toBe('failure')
  })

  it('never overwrites a snapshot: the same minute twice gives two files', async () => {
    const root = dir()
    const a = await runCapture({ root, sources: NEWS_SOURCES, load: load(), now: at('2026-11-14T14:40:00Z') })
    const b = await runCapture({ root, sources: NEWS_SOURCES, load: load(), now: at('2026-11-14T14:40:00Z') })
    expect(a.snapshot).not.toBe(b.snapshot)
    expect(snapshots(root)).toHaveLength(2)
  })

  it('a run while another holds the lock changes nothing and records itself as skipped', async () => {
    const root = dir()
    await runCapture({ root, sources: NEWS_SOURCES, load: load() })
    writeFileSync(join(root, 'capture.lock'), 'pid 1')
    const r = await runCapture({ root, sources: NEWS_SOURCES, load: load() })
    expect(r.status).toBe('skipped-locked')
    expect(r.exitCode).toBe(EXIT['skipped-locked'])
    expect(snapshots(root)).toHaveLength(1)
    expect(existsSync(join(root, 'capture.lock'))).toBe(true)
  })

  it('a lock left by a crashed run is cleared after 30 minutes, and noted', async () => {
    const root = dir()
    await runCapture({ root, sources: NEWS_SOURCES, load: load() })
    writeFileSync(join(root, 'capture.lock'), 'pid 1')
    const old = new Date(Date.now() - 60 * 60_000)
    utimesSync(join(root, 'capture.lock'), old, old)
    const r = await runCapture({ root, sources: NEWS_SOURCES, load: load() })
    expect(r.status).toBe('success')
    expect(r.notes.join()).toContain('stale lock')
  })

  it('a run long after its scheduled time is recorded as a catch-up, with how late it was', async () => {
    const root = dir()
    // 15:40 Stockholm = 14:40 UTC in November; the machine woke at 19:10 Stockholm
    const r = await runCapture({ root, sources: NEWS_SOURCES, load: load(), now: at('2026-11-14T18:10:00Z'), scheduledLocalTime: '15:40' })
    expect(r.trigger).toBe('catch-up')
    expect(r.minutesLate).toBe(210)
    expect(minutesLate(new Date('2026-07-01T13:45:00Z'), '15:40')).toBe(5) // summer time: 15:45 Stockholm
  })
})
