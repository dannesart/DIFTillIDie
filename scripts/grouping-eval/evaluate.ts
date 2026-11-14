// Step 4: evaluate the frozen hypothesis on a snapshot whose labels are already pinned. Logs every run.
// npx jiti scripts/grouping-eval/evaluate.ts <snapshot.json> <labels.json>
// Output names only article numbers, event ids and rules (no feed text), so it can be shared.
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fold } from '../../server/lib/news'
import { groupIntoStories } from '../../server/lib/grouping'
import type { Evidence, Judgement } from '../../server/lib/eventEvidence'
import { EVH_VERSION, evidence, judge } from '../../server/lib/eventEvidence'
import type { LabelsV1, LabelsV2, Snapshot, Truth } from './lib'
import { EVALUATIONS, PINS, REGISTRY, ROOT, fileSha, numbered, readJson, sha256, truthOf, writeJson } from './lib'

const [snapFile, labelFile] = process.argv.slice(2)
if (!snapFile || !labelFile) throw new Error('usage: evaluate.ts <snapshot.json> <labels.json>')
const labelSha = fileSha(labelFile)
if (!readJson<{ sha256: string }[]>(PINS, []).some(p => p.sha256 === labelSha)) throw new Error('labels are not pinned (or changed since pinning): run pin.ts first')

const snap = readJson<Snapshot>(snapFile)
const labels = readJson<LabelsV1 | LabelsV2>(labelFile)
const registry = readJson<Record<string, { development: boolean }>>(REGISTRY, {})
const scorerSha = sha256(readFileSync('server/lib/eventEvidence.ts', 'utf8').replace(/\r\n/g, '\n'))
const truth = truthOf(labels)
const label = new Map(labels.articles.map(l => [l.id, l as LabelsV2['articles'][number] & LabelsV1['articles'][number]]))
const arts = numbered(snap)
const ev = new Map<string, Evidence>(arts.map(a => [a.id, evidence(a)]))
const num = (id: string) => label.get(id)!.n
const isNew = (id: string) => { const e = label.get(id)!.event; return !!e && registry[e]?.development === false }

interface Row { a: string, b: string, t: Truth, j: Judgement, fresh: boolean }
const rows: Row[] = []
for (let i = 0; i < arts.length; i++) {
  for (let k = i + 1; k < arts.length; k++) {
    const [a, b] = [arts[i]!.id, arts[k]!.id]
    rows.push({ a, b, t: truth(a, b), j: judge(ev.get(a)!, ev.get(b)!), fresh: isNew(a) && isNew(b) })
  }
}

// Why an error happened, from the labeller's gold action / background / anchors (labels v2 only).
const words = (xs: string[]) => new Set(xs.flatMap(x => fold(x).split(/[^a-z0-9]+/)).filter(w => w.length >= 3))
function causes(r: Row): string[] {
  const [la, lb] = [label.get(r.a)!, label.get(r.b)!]
  if (!la.gold || !lb.gold) return ['unattributed (labels v1)']
  const out = new Set<string>()
  for (const [l, e] of [[la, ev.get(r.a)!], [lb, ev.get(r.b)!]] as const) {
    const g = l.gold!
    if ([...e.reported].some(x => g.background.includes(x))) out.add('background mention')
    if ((g.action && !e.reported.has(g.action)) || [...e.reported].some(x => x !== g.action && !g.background.includes(x))) out.add('action detection')
  }
  const goldShared = [...words(la.gold.anchors)].some(w => words(lb.gold!.anchors).has(w))
  if (r.j.verdict === 'same' && !goldShared && r.j.anchors.length) out.add('anchor detection (false anchor)')
  if (r.j.verdict !== 'same' && goldShared && !r.j.anchors.length) out.add('anchor detection (missed anchor)')
  if (r.t === 'related-distinct') out.add('event ambiguity (related development)')
  if (!out.size) out.add(`hypothesis rule (${r.j.rule})`)
  return [...out]
}

function report(subset: Row[], title: string) {
  const confident = subset.filter(r => r.t !== 'insufficient')
  const same = confident.filter(r => r.t === 'same')
  const predicted = confident.filter(r => r.j.verdict === 'same')
  const tp = predicted.filter(r => r.t === 'same')
  const merges = predicted.filter(r => r.t !== 'same')
  const splits = same.filter(r => r.j.verdict === 'not-same')
  const abstained = same.filter(r => r.j.verdict === 'insufficient')
  const pct = (x: number, y: number) => (y ? `${(100 * x / y).toFixed(0)}%` : 'n/a')
  const events = new Set(subset.flatMap(r => [r.a, r.b]).map(id => label.get(id)!.event).filter(Boolean))
  const positiveEvents = new Set(same.map(r => label.get(r.a)!.event))
  const lines = [
    `== ${title}`,
    `pairs: same ${same.length}, related-distinct ${confident.filter(r => r.t === 'related-distinct').length}, different ${confident.filter(r => r.t === 'different').length}, insufficient ${subset.length - confident.length}`,
    `distinct labelled events ${events.size}; events with a same-occurrence pair ${positiveEvents.size}`,
    `precision ${tp.length}/${predicted.length} = ${pct(tp.length, predicted.length)}   recall ${tp.length}/${same.length} = ${pct(tp.length, same.length)}`,
    `false merges ${merges.length} (related-distinct ${merges.filter(r => r.t === 'related-distinct').length}, different ${merges.filter(r => r.t === 'different').length})   false splits ${splits.length}   abstained on same ${abstained.length}`,
    `insufficient-labelled pairs judged same ${subset.filter(r => r.t === 'insufficient' && r.j.verdict === 'same').length}`,
  ]
  for (const [name, rs] of [['false merge', merges], ['false split', splits], ['abstained', abstained]] as const) {
    for (const r of rs) lines.push(`  ${name} ${num(r.a)}–${num(r.b)} [${label.get(r.a)!.event} / ${label.get(r.b)!.event}] ${r.j.rule}: ${causes(r).join('; ')}`)
  }
  return { lines, metrics: { pairs: subset.length, same: same.length, predicted: predicted.length, tp: tp.length, falseMerges: merges.length, falseSplits: splits.length, abstained: abstained.length, events: events.size, positiveEvents: positiveEvents.size } }
}

const all = report(rows, `${EVH_VERSION} on ${basename(snapFile)} (all pairs)`)
const fresh = report(rows.filter(r => r.fresh), 'new events only (not in the development set)')

// Baseline: production's groupIntoStories, read as pairs (same Story = judged same).
const home = new Map(groupIntoStories(snap.articles).flatMap((s, i) => s.sources.map(a => [a.id, i] as const)))
const baseline = (subset: Row[]) => {
  const c = subset.filter(r => r.t !== 'insufficient')
  const together = c.filter(r => home.get(r.a) === home.get(r.b))
  const tp = together.filter(r => r.t === 'same').length
  return `production baseline: precision ${tp}/${together.length}, recall ${tp}/${c.filter(r => r.t === 'same').length}, false merges ${together.length - tp}`
}
const out = [...all.lines, baseline(rows), '', ...fresh.lines, baseline(rows.filter(r => r.fresh))].join('\n')
console.log(out)
writeJson(join(ROOT, 'results', `${basename(snapFile, '.json')}.${EVH_VERSION}.json`), { hypothesis: EVH_VERSION, scorerSha, labelSha, all: all.metrics, fresh: fresh.metrics, text: out })
const log = readJson<unknown[]>(EVALUATIONS, [])
log.push({ at: new Date().toISOString(), hypothesis: EVH_VERSION, scorerSha, snapshot: basename(snapFile), labels: basename(labelFile), labelSha, all: all.metrics, fresh: fresh.metrics })
writeJson(EVALUATIONS, log)
