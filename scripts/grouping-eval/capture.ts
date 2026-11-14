// Step 1: capture the live feeds as getNews() reads them (uncached) into the private folder.
// npx jiti scripts/grouping-eval/capture.ts
import { join } from 'node:path'
import { NEWS_SOURCES, loadSource } from '../../server/lib/news'
import { ROOT, writeJson } from './lib'

const results = await Promise.all(NEWS_SOURCES.map(s => loadSource(s, { lastGood: new Map() })))
const capturedAt = new Date().toISOString()
const file = join(ROOT, 'snapshots', `snapshot-${capturedAt.slice(0, 16).replace(/[:T]/g, '')}.json`)
writeJson(file, { capturedAt, sources: results.map(r => r.status), articles: results.flatMap(r => r.articles) }, { overwrite: false })
console.log(file, results.reduce((n, r) => n + r.articles.length, 0), 'articles;', results.map(r => `${r.status.id}:${r.status.ok ? 'ok' : r.status.error}`).join(' '))
