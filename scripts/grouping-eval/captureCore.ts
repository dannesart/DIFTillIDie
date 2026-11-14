// One evidence capture (Issue #25): fetch every configured feed once, keep the full result privately, and record
// the run. Captures evidence only: it never labels, pins, evaluates or touches the event registry.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { FeedStatus } from '../../shared/types/domain'
import type { NewsSource, SourceResult } from '../../server/lib/news'

export type CaptureStatus = 'success' | 'partial' | 'failure' | 'skipped-locked'
/** Exit codes, so Task Scheduler's "Last Run Result" shows the outcome: 0 success, 2 partial, 1 failure, 3 locked. */
export const EXIT: Record<CaptureStatus, number> = { 'success': 0, 'failure': 1, 'partial': 2, 'skipped-locked': 3 }

export interface CaptureRecord {
  runId: string
  trigger: 'manual' | 'scheduled' | 'catch-up'
  /** For scheduled runs: the local schedule time, and how late the run actually started. */
  scheduledLocalTime?: string
  minutesLate?: number
  startedAt: string
  finishedAt: string
  status: CaptureStatus
  exitCode: number
  snapshot: string | null
  articleCount: number
  sources: Pick<FeedStatus, 'id' | 'ok' | 'error' | 'itemCount' | 'relevantCount' | 'fetchedAt'>[]
  notes: string[]
}

export interface CaptureOptions {
  root: string
  sources: NewsSource[]
  load: (source: NewsSource) => Promise<SourceResult>
  now?: () => Date
  /** "HH:MM" in Europe/Stockholm when run by the scheduler; absent for manual runs. */
  scheduledLocalTime?: string
  /** A lock older than this is left by a crashed run and may be cleared. */
  staleLockMinutes?: number
}

export const RUNS = 'capture-runs.jsonl'
const LOCK = 'capture.lock'

/** Minutes between the scheduled Stockholm time today (or yesterday, if not yet reached) and `at`. */
export function minutesLate(at: Date, scheduledLocalTime: string): number {
  const [h, m] = scheduledLocalTime.split(':').map(Number) as [number, number]
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const local = Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value)
  return (local - (h * 60 + m) + 1440) % 1440
}

/** Writes `body` to a new file; never replaces one. Adds -2, -3 … if the name is taken. Returns the name used. */
function writeNew(dir: string, base: string, body: string): string {
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? `${base}.json` : `${base}-${n}.json`
    let fd: number
    try {
      fd = openSync(join(dir, name), 'wx')
    }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw e
    }
    try {
      writeSync(fd, body)
    }
    finally {
      closeSync(fd)
    }
    return name
  }
  throw new Error(`no free snapshot name for ${base}`)
}

export async function runCapture(opts: CaptureOptions): Promise<CaptureRecord> {
  const now = opts.now ?? (() => new Date())
  const started = now()
  const notes: string[] = []
  const late = opts.scheduledLocalTime ? minutesLate(started, opts.scheduledLocalTime) : undefined
  const record: CaptureRecord = {
    runId: started.toISOString(),
    trigger: late === undefined ? 'manual' : late <= 15 ? 'scheduled' : 'catch-up',
    ...(opts.scheduledLocalTime ? { scheduledLocalTime: opts.scheduledLocalTime, minutesLate: late } : {}),
    startedAt: started.toISOString(),
    finishedAt: '',
    status: 'failure',
    exitCode: EXIT.failure,
    snapshot: null,
    articleCount: 0,
    sources: [],
    notes,
  }
  mkdirSync(join(opts.root, 'snapshots'), { recursive: true })
  const finish = (status: CaptureStatus) => {
    record.status = status
    record.exitCode = EXIT[status]
    record.finishedAt = now().toISOString()
    appendFileSync(join(opts.root, RUNS), `${JSON.stringify(record)}\n`)
    return record
  }

  // One capture at a time: a second run while one holds the lock records itself as skipped and changes nothing.
  const lock = join(opts.root, LOCK)
  if (existsSync(lock)) {
    const ageMin = (now().getTime() - statSync(lock).mtimeMs) / 60_000
    if (ageMin < (opts.staleLockMinutes ?? 30)) {
      notes.push(`another capture holds the lock (${readFileSync(lock, 'utf8').trim()})`)
      return finish('skipped-locked')
    }
    unlinkSync(lock)
    notes.push(`cleared a stale lock (${Math.round(ageMin)} min old)`)
  }
  let fd: number
  try {
    fd = openSync(lock, 'wx')
  }
  catch {
    notes.push('another capture took the lock')
    return finish('skipped-locked')
  }
  try {
    writeSync(fd, `pid ${process.pid} since ${record.startedAt}`)
    closeSync(fd)
    const results = await Promise.all(opts.sources.map(s => opts.load(s)))
    record.sources = results.map(({ status: s }) => ({ id: s.id, ok: s.ok, error: s.error, itemCount: s.itemCount, relevantCount: s.relevantCount, fetchedAt: s.fetchedAt }))
    const failed = record.sources.filter(s => !s.ok)
    // A failed source has no articles in this run (no "last good" data is carried between captures).
    const articles = results.flatMap(r => (r.status.ok ? r.articles : []))
    record.articleCount = articles.length
    if (failed.length === results.length) {
      notes.push('every source failed: no snapshot written')
      return finish('failure')
    }
    const status: CaptureStatus = failed.length ? 'partial' : 'success'
    if (failed.length) notes.push(`incomplete: ${failed.map(s => s.id).join(', ')} failed`)
    const capturedAt = now().toISOString()
    const body = JSON.stringify({
      capturedAt,
      capture: { status, complete: !failed.length, trigger: record.trigger, startedAt: record.startedAt, scheduledLocalTime: opts.scheduledLocalTime, minutesLate: late },
      sources: results.map(r => r.status),
      articles,
    }, null, 1)
    record.snapshot = writeNew(join(opts.root, 'snapshots'), `snapshot-${capturedAt.slice(0, 16).replace(/[:T]/g, '')}`, `${body}\n`)
    return finish(status)
  }
  catch (e) {
    notes.push(`error: ${(e as Error).message}`)
    return finish('failure')
  }
  finally {
    try {
      unlinkSync(lock)
    }
    catch {}
  }
}
