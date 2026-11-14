// Shared helpers for the #25 evidence evaluation (docs/grouping-evidence.md). Original code only: every input
// with third-party text (snapshots) and every label lives in the gitignored .data/grouping-eval/.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SourceArticle } from '../../shared/types/domain'
import { canonicalArticles } from '../../server/lib/groupingCandidates'
import type { Action } from '../../server/lib/eventEvidence'

/** The private data folder; GROUPING_EVAL_ROOT overrides it (e.g. to try the scripts on synthetic data). */
export const ROOT = process.env.GROUPING_EVAL_ROOT ?? '.data/grouping-eval'
export const PINS = join(ROOT, 'pins.json')
export const EVALUATIONS = join(ROOT, 'evaluations.json')
export const REGISTRY = join(ROOT, 'events-registry.json')

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const fileSha = (path: string) => sha256(readFileSync(path, 'utf8'))
export const readJson = <T>(path: string, fallback?: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback as T)
export function writeJson(path: string, value: unknown, { overwrite = true } = {}) {
  if (!overwrite && existsSync(path)) throw new Error(`refusing to overwrite ${path}`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`)
}

export interface Snapshot { capturedAt: string, articles: SourceArticle[] }
/** Articles in the order labels number them: one per canonical URL, by time, then id. */
export const numbered = (snap: Snapshot) => canonicalArticles(snap.articles)

/** Version-2 labels. Written before any hypothesis output for the snapshot is seen. */
export interface LabelsV2 {
  schema: 2
  snapshot: string
  labelledAt: string
  labeller: string
  /** Must stay false: labels written after seeing hypothesis output are not evidence. */
  hypothesisOutputSeen: false
  events: Record<string, { description: string, registry: 'new' | `known:${string}` }>
  /** Event pairs that are a related development but a distinct occurrence, or where the relation is unclear. */
  relations: { events: [string, string], relation: 'related-distinct' | 'insufficient', reason: string }[]
  articles: {
    n: number
    id: string
    event: string | null
    confidence: 'confident' | 'insufficient'
    reason: string
    /** Exact phrases from this article's headline or teaser that the label rests on. */
    feedEvidence: string[]
    /** What the label needed from outside the feed (nicknames, roles, earlier events). */
    outsideKnowledge: string[]
    gold?: { action: Action | null, background: Action[], anchors: string[] }
  }[]
}
/** Version-1 labels (the 2026-11-14 development snapshot): same / different / uncertain only. */
export interface LabelsV1 {
  snapshot: string
  uncertainRelations: [string, string, string?][]
  articles: { n: number, id: string, event: string, confidence: 'confident' | 'uncertain' }[]
}
export type Truth = 'same' | 'related-distinct' | 'different' | 'insufficient'

export function truthOf(labels: LabelsV1 | LabelsV2): (a: string, b: string) => Truth {
  const byId = new Map<string, { event: string | null, confident: boolean }>(
    labels.articles.map(l => [l.id, { event: l.event, confident: l.confidence === 'confident' }]),
  )
  const key = (x: string, y: string) => [x, y].sort().join('|')
  const rel = new Map<string, Truth>()
  if ('schema' in labels) for (const r of labels.relations) rel.set(key(...r.events), r.relation)
  else for (const [x, y] of labels.uncertainRelations) rel.set(key(x, y), 'insufficient')
  return (a, b) => {
    const [x, y] = [byId.get(a), byId.get(b)]
    if (!x || !y) throw new Error(`unlabelled article ${!x ? a : b}`)
    if (!x.confident || !y.confident || !x.event || !y.event) return 'insufficient'
    if (x.event === y.event) return 'same'
    return rel.get(key(x.event, y.event)) ?? 'different'
  }
}
