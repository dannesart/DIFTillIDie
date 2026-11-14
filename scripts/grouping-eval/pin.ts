// Step 3: validate a finished label file and pin its hash BEFORE any evaluation of its snapshot.
// Registers the snapshot's events in events-registry.json. Never modifies the label file.
// npx jiti scripts/grouping-eval/pin.ts <snapshot.json> <labels.json>
import { basename } from 'node:path'
import type { LabelsV1, LabelsV2, Snapshot } from './lib'
import { EVALUATIONS, PINS, REGISTRY, fileSha, numbered, readJson, writeJson } from './lib'

const [snapFile, labelFile] = process.argv.slice(2)
if (!snapFile || !labelFile) throw new Error('usage: pin.ts <snapshot.json> <labels.json>')
const snap = readJson<Snapshot>(snapFile)
const labels = readJson<LabelsV1 | LabelsV2>(labelFile)
const arts = numbered(snap)
const problems: string[] = []

const evaluated = readJson<{ snapshot: string }[]>(EVALUATIONS, []).some(e => e.snapshot === basename(snapFile))
if (evaluated) problems.push('this snapshot has already been evaluated: labels must be pinned first')
const ids = new Set(labels.articles.map(l => l.id))
for (const a of arts) if (!ids.has(a.id)) problems.push(`article ${a.id} has no label`)

const development = !('schema' in labels)
if ('schema' in labels) {
  if (labels.hypothesisOutputSeen !== false) problems.push('hypothesisOutputSeen must be false')
  if (!labels.labelledAt || !labels.labeller) problems.push('labelledAt and labeller are required')
  for (const r of labels.relations) for (const e of r.events) if (!labels.events[e]) problems.push(`relation names unknown event ${e}`)
  for (const l of labels.articles) {
    const a = arts.find(x => x.id === l.id)
    if (!a) { problems.push(`label for unknown article ${l.id}`); continue }
    if (l.event && !labels.events[l.event]) problems.push(`${l.n}: unknown event ${l.event}`)
    if (l.confidence === 'confident' && !l.event) problems.push(`${l.n}: confident but no event`)
    if (!l.reason) problems.push(`${l.n}: reason is required`)
    if (l.confidence === 'confident' && !l.feedEvidence.length) problems.push(`${l.n}: confident labels need feed evidence`)
    for (const phrase of l.feedEvidence) if (!`${a.headline}\n${a.excerpt ?? ''}`.includes(phrase)) problems.push(`${l.n}: feed evidence not found verbatim: "${phrase}"`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

const sha = fileSha(labelFile)
const pins = readJson<{ file: string, sha256: string, pinnedAt: string }[]>(PINS, [])
if (!pins.some(p => p.sha256 === sha)) pins.push({ file: labelFile, sha256: sha, pinnedAt: new Date().toISOString() })
writeJson(PINS, pins)

const registry = readJson<Record<string, { description: string, firstSnapshot: string, development: boolean }>>(REGISTRY, {})
if ('schema' in labels) {
  for (const [id, e] of Object.entries(labels.events)) {
    if (e.registry === 'new' && !registry[id]) registry[id] = { description: e.description, firstSnapshot: basename(snapFile), development: false }
    if (e.registry.startsWith('known:') && !registry[e.registry.slice(6)]) console.warn(`event ${id} claims a registry entry that does not exist: ${e.registry}`)
  }
}
else {
  for (const l of labels.articles) registry[l.event] ??= { description: '(development snapshot, labels v1)', firstSnapshot: basename(snapFile), development }
}
writeJson(REGISTRY, registry)
console.log(`pinned ${labelFile} sha256 ${sha}`)
