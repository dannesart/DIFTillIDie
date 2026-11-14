// Step 2: print a snapshot for labelling and write an empty version-2 label file. Runs no hypothesis.
// npx jiti scripts/grouping-eval/label-template.ts .data/grouping-eval/snapshots/snapshot-<UTC>.json
// Read the printed text in full: never filter it (a `grep -v profile` once hid a teaser containing "profilen").
import { basename, join } from 'node:path'
import type { LabelsV2, Snapshot } from './lib'
import { ROOT, numbered, readJson, writeJson } from './lib'

const snapFile = process.argv[2]
if (!snapFile) throw new Error('usage: label-template.ts <snapshot.json>')
const snap = readJson<Snapshot>(snapFile)
const arts = numbered(snap)
arts.forEach((a, i) => console.log(`${String(i + 1).padStart(2, '0')} ${a.publishedAt.slice(0, 16)} ${a.sport} ${a.reporting} ${a.outlet}\n   H: ${a.headline}\n   T: ${a.excerpt ?? ''}`))

const labels: LabelsV2 = {
  schema: 2,
  snapshot: basename(snapFile),
  labelledAt: '',
  labeller: '',
  hypothesisOutputSeen: false,
  events: {},
  relations: [],
  articles: arts.map((a, i) => ({ n: i + 1, id: a.id, event: null, confidence: 'insufficient', reason: '', feedEvidence: [], outsideKnowledge: [], gold: { action: null, background: [], anchors: [] } })),
}
const out = join(ROOT, 'labels', basename(snapFile).replace(/^snapshot-/, 'labels-').replace(/\.json$/, '.v2.json'))
writeJson(out, labels, { overwrite: false })
console.log(`\nwrote ${out}: fill in events, relations and every article, then pin it before evaluating.`)
