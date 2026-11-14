import type { SourceArticle } from '../../shared/types/domain'
import { fold } from './news'
import { namesInSentences } from './groupingCandidates'

/*
 * EVH-1: a FROZEN experimental hypothesis about event identity (Issue #25). Not used by the app and not a
 * grouping algorithm: it only judges one pair of articles at a time, so it can be evaluated against labels.
 * See docs/grouping-evidence.md for the hypothesis in words and the evaluation protocol.
 *
 * Frozen: tests/event-evidence.test.ts pins a hash of this file. Any change, including a lexicon word, is a new
 * hypothesis version (EVH-2, …) and must be evaluated as such, never folded silently into EVH-1.
 *
 * In short: two articles may describe the same occurrence when they report a compatible action AND share an
 * anchor specific enough for that kind of action. A shared action type alone, or a shared name alone, is never
 * a match. Background mentions are not reported actions. When evidence is missing the answer is 'insufficient'.
 */

export const EVH_VERSION = 'EVH-1'

export type Action = 'dismissal' | 'departure' | 'contract' | 'injury' | 'national' | 'result' | 'preview' | 'candidacy'
export type Verdict = 'same' | 'not-same' | 'insufficient'

export const EVH1 = {
  version: EVH_VERSION,
  /** Articles further apart than this are never judged the same occurrence. */
  maxHoursApart: 48,
  /**
   * Reported-action cues, folded (å→a, ö→o …). A cue of 5+ letters matches a word's start; a shorter cue the whole
   * word; a phrase matches word by word. General football vocabulary only: no person, club or article names.
   */
  actions: {
    dismissal: ['sparka', 'sparken', 'sparkas', 'avsked', 'entledig', 'bryter med', 'skilja', 'skiljs', 'tranarbyte', 'tranarskifte', 'far ga'],
    departure: ['lamnar', 'flytten', 'flyttar till', 'klar for', 'skriver pa', 'skrivit pa', 'overgang', 'koper', 'saljer', 'utlanad', 'varvar', 'varvning'],
    contract: ['forlang', 'kontrakt'],
    injury: ['skada', 'skadad', 'opereras', 'opererad', 'rehab', 'tillbaka i traning'],
    national: ['landslag', 'forbundskapten', 'uttagen', 'uttagna'],
    result: ['vann', 'vinst', 'forlust', 'forlorade', 'foll', 'kryss', 'oavgjort', 'utvisad', 'utvisning'],
    preview: ['gar for seger', 'startelva', 'laguttagning', 'infor matchen'],
    candidacy: ['onskelista', 'aktuell', 'tranarjakt', 'kandidat', 'dementerar', 'ryktas'],
  } satisfies Record<Action, string[]>,
  /** Words that make a cue a background mention when they come up to `backgroundReach` words before it. */
  backgroundFrames: ['efter', 'sedan'],
  backgroundReach: 3,
  /** Words that, right before a past participle cue, make it an attribute ("den sparkade tränaren"). */
  determiners: ['den', 'det', 'de', 'forre', 'nyss', 'nyligen', 'tidigare'],
  /** Nouns that point back at an occurrence already reported (a reaction or explanation). */
  backReferences: ['beslutet', 'beskedet', 'avskedet', 'besked', 'beslut'],
  /** Verbs after which the preceding names are a speaker, not a participant. */
  speechVerbs: ['sager', 'bedomer', 'menar', 'motiverar', 'uppger', 'berattar', 'beskriver', 'forklarar', 'slar fast', 'uttrycker', 'kommenterar', 'svarar', 'pekar ut'],
  /** Role words: a head-coach change at one club is one occurrence (assumption A1, documented). */
  coachRole: 'tranar',
  /** Which anchor each action needs to be specific. */
  needs: {
    dismissal: 'person-or-club-coach',
    departure: 'person',
    contract: 'person',
    injury: 'person',
    national: 'person',
    candidacy: 'person',
    result: 'opponent',
    preview: 'opponent',
  } satisfies Record<Action, 'person' | 'person-or-club-coach' | 'opponent'>,
  /** Names within this edit distance (and at least this long) are the same name: misspellings. */
  fuzzy: { distance: 1, minLength: 6 },
} as const

interface Word { surface: string, folded: string }
const WORD = /[\p{L}][\p{L}\p{M}'’-]*/gu
const wordsOf = (text: string): Word[] => [...text.matchAll(WORD)]
  .flatMap(m => m[0].split(/[-–]/))
  .filter(Boolean)
  .map(surface => ({ surface, folded: fold(surface).replace(/[^a-z0-9]/g, '') }))
  .filter(w => w.folded)
const cueMatch = (w: string, c: string) => (c.length < 5 ? w === c : w.startsWith(c))
/** Indexes where a (possibly multi-word) cue starts. */
const findCue = (ws: Word[], cue: string) => {
  const parts = cue.split(' ')
  return ws.flatMap((_, i) => (parts.every((p, k) => !!ws[i + k] && cueMatch(ws[i + k]!.folded, p)) ? [i] : []))
}

export interface Evidence {
  article: SourceArticle
  time: number
  reported: Set<Action>
  background: Set<Action>
  backReference: boolean
  /** Names that are neither speakers nor generic: who or what the article is about. */
  participants: Set<string>
  speakers: Set<string>
  opponents: Set<string>
  club: boolean
  coachRole: boolean
}

function actionsIn(text: string, reported: Set<Action>, background: Set<Action>) {
  const ws = wordsOf(text)
  for (const [action, cues] of Object.entries(EVH1.actions) as [Action, readonly string[]][]) {
    for (const cue of cues) {
      for (const i of findCue(ws, cue)) {
        const before = ws.slice(Math.max(0, i - EVH1.backgroundReach), i).map(w => w.folded)
        const prev = ws[i - 1]
        const participle = /(ade|ad|at|de)$/.test(ws[i]!.folded) && !cue.includes(' ')
        const attribute = participle && (
          (prev && ((EVH1.determiners as readonly string[]).includes(prev.folded) || /^\p{Lu}.*s$/u.test(prev.surface)))
          || (i === 0 && !!ws[1] && /^\p{Lu}/u.test(ws[1].surface)))
        const framed = before.some(b => (EVH1.backgroundFrames as readonly string[]).includes(b))
        ;(attribute || framed ? background : reported).add(action)
      }
    }
  }
}

function speakersIn(a: SourceArticle): Set<string> {
  const out = new Set<string>()
  // Headline segments opening with up to three words and a colon: "Lund:", "… – Ola Lund: …"
  for (const seg of a.headline.split(/\s[–-]\s/)) {
    const m = seg.match(/^\s*([^:”"“]{1,40}?)(:| om )/u)
    if (m && m[1]!.trim().split(/\s+/).length <= 3) for (const n of namesInSentences(m[1]!)) out.add(n)
  }
  // Teaser: up to three words before a speech verb: "Tidningens Ola Lund bedömer …"
  const text = a.excerpt ?? ''
  const ws = [...text.matchAll(WORD)]
  for (const verb of EVH1.speechVerbs) {
    const parts = verb.split(' ')
    ws.forEach((m, i) => {
      if (!parts.every((p, k) => ws[i + k] && fold(ws[i + k]![0]).startsWith(p))) return
      for (const n of namesInSentences(ws.slice(Math.max(0, i - 3), i).map(x => x[0]).join(' '))) out.add(n)
    })
  }
  return out
}

export function evidence(a: SourceArticle): Evidence {
  const reported = new Set<Action>()
  const background = new Set<Action>()
  for (const text of [a.headline, a.excerpt ?? '']) actionsIn(text, reported, background)
  for (const r of reported) background.delete(r)
  const all = `${a.headline} ${a.excerpt ?? ''}`
  const ws = wordsOf(all)
  const h = namesInSentences(a.headline)
  const names = new Set([...h, ...namesInSentences(a.excerpt ?? '', h)])
  const speakers = speakersIn(a)
  const opponents = new Set<string>()
  ws.forEach((w, i) => {
    const next = ws[i + 1]
    if (w.folded === 'mot' && next && /^\p{Lu}/u.test(next.surface)) for (const n of namesInSentences(next.surface)) opponents.add(n)
  })
  return {
    article: a,
    time: Date.parse(a.publishedAt),
    reported,
    background,
    backReference: ws.some(w => (EVH1.backReferences as readonly string[]).includes(w.folded)),
    participants: new Set([...names].filter(n => !speakers.has(n))),
    speakers,
    opponents,
    club: /djurg[aå]rd|\bDIF\b/iu.test(all),
    coachRole: ws.some(w => w.folded.includes(EVH1.coachRole)),
  }
}

const distance = (s: string, t: string) => {
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array<number>(t.length).fill(0)])
  for (let j = 1; j <= t.length; j++) d[0]![j] = j
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (s[i - 1] === t[j - 1] ? 0 : 1))
  }
  return d[s.length]![t.length]!
}
const sameName = (x: string, y: string) => x === y
  || (x.length >= EVH1.fuzzy.minLength && y.length >= EVH1.fuzzy.minLength && distance(x, y) <= EVH1.fuzzy.distance)
const shared = (x: Set<string>, y: Set<string>) => [...x].filter(n => [...y].some(m => sameName(n, m)))

export interface Judgement {
  verdict: Verdict
  /** Which rule decided, for error analysis. */
  rule: string
  actions: Action[]
  anchors: string[]
}

/** EVH-1's judgement of one pair. Symmetric, and independent of any other article. */
export function judge(p: Evidence, q: Evidence): Judgement {
  const no = (rule: string): Judgement => ({ verdict: 'not-same', rule, actions: [], anchors: [] })
  if (p.article.sport !== q.article.sport) return no('different sport')
  if (Math.abs(p.time - q.time) > EVH1.maxHoursApart * 3_600_000) return no('too far apart in time')
  // A name anchors when at least one article names it as a participant: the affected person may speak in the
  // other ("Ek om sparken"), but a name that is only ever a speaker (a spokesperson in both) anchors nothing.
  const persons = [...new Set([
    ...shared(p.participants, new Set([...q.participants, ...q.speakers])),
    ...shared(new Set([...p.participants, ...p.speakers]), q.participants),
  ])]
  const opponents = shared(p.opponents, q.opponents)
  const common = [...p.reported].filter(a => q.reported.has(a))

  if (p.reported.size && q.reported.size) {
    if (!common.length) return { verdict: 'not-same', rule: 'incompatible reported actions', actions: [], anchors: persons }
    for (const action of common) {
      const need = EVH1.needs[action]
      const clubCoach = action === 'dismissal' && p.club && q.club && p.coachRole && q.coachRole
      const anchors = need === 'opponent' ? opponents : persons
      if (anchors.length) return { verdict: 'same', rule: `${action} + ${need === 'opponent' ? 'opponent' : 'person'}`, actions: [action], anchors }
      if (need === 'person-or-club-coach' && clubCoach) return { verdict: 'same', rule: 'dismissal + club head coach (A1)', actions: [action], anchors: ['club head coach'] }
    }
    return { verdict: 'insufficient', rule: 'shared action type without a specific anchor', actions: common, anchors: persons }
  }
  if (p.reported.size || q.reported.size) {
    const silent = p.reported.size ? q : p
    if (silent.backReference && persons.length) return { verdict: 'same', rule: 'reaction refers back + person', actions: [...(p.reported.size ? p : q).reported], anchors: persons }
    return persons.length ? { verdict: 'insufficient', rule: 'shared anchor, one action unknown', actions: [], anchors: persons } : no('nothing shared')
  }
  return persons.length ? { verdict: 'insufficient', rule: 'shared anchor, no reported action', actions: [], anchors: persons } : no('nothing shared')
}
