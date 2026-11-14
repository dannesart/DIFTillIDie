// Step 1: capture the live feeds as getNews() reads them (uncached) into the private folder, and record the run
// in capture-runs.jsonl. Evidence only: never labels, pins or evaluates.
//   npx jiti scripts/grouping-eval/capture.ts                      (manual)
//   npx jiti scripts/grouping-eval/capture.ts --scheduled 15:40    (from the daily task; records lateness)
// Exit code: 0 success, 2 partial (some sources failed; snapshot marked incomplete), 1 failure, 3 another run active.
import { NEWS_SOURCES, loadSource } from '../../server/lib/news'
import { runCapture } from './captureCore'
import { ROOT } from './lib'

const i = process.argv.indexOf('--scheduled')
const scheduledLocalTime = i > -1 ? process.argv[i + 1] : undefined
if (scheduledLocalTime !== undefined && !/^\d{2}:\d{2}$/.test(scheduledLocalTime)) throw new Error('--scheduled needs HH:MM')

const record = await runCapture({ root: ROOT, sources: NEWS_SOURCES, load: s => loadSource(s, { lastGood: new Map() }), scheduledLocalTime })
console.log(`${record.status}: ${record.snapshot ?? 'no snapshot'}, ${record.articleCount} articles; ${record.sources.map(s => `${s.id}:${s.ok ? `ok ${s.relevantCount}/${s.itemCount}` : `FAILED ${s.error}`}`).join(' ')}${record.notes.length ? `; ${record.notes.join('; ')}` : ''}`)
process.exitCode = record.exitCode
