import type { SourceArticle, Story } from '../../shared/types/domain'
import { canonicalUrl, fold } from './news'
import type { Profile } from './grouping'
import { MIN_SHARED, WINDOW_HOURS, namesIn, profile, sharedNames, toStories } from './grouping'

/*
 * Candidate grouping algorithms for Issue #25, for comparison only: groupIntoStories is unchanged and is
 * still what the app uses. Each candidate is a combination of:
 *  - names:   'current' (namesIn as today) or 'sentence' (a capitalised word that only ever opens a
 *             sentence after the first is an ordinary word, not a name);
 *  - link:    'names' (today's rule: two shared names, one in both headlines) or 'event' (the same names
 *             evidence, plus what kind of event each article reports: two articles reporting different
 *             kinds of event are never linked, and two reporting the same kind need only one shared name
 *             in both headlines); 'event-only' links only articles reporting the same kind of event; 'veto' is
 *             today's rule, except that articles reporting different kinds of event never link;
 *  - cluster: 'single' (any link joins, as today) or 'majority' (two groups join only when at least half
 *             of the pairs between them link directly);
 *  - spanHours: the most time one Story may span, first article to last.
 * Every candidate is computed in a canonical order (time, then id) with id-based tie-breaks, so the same
 * articles in any order give the same Stories.
 */

export interface Candidate {
  names: 'current' | 'sentence'
  link: 'names' | 'veto' | 'event' | 'event-only'
  cluster: 'single' | 'majority'
  spanHours?: number
  /** Where event kinds are read: the headline only (default), or headline and teaser. */
  kindsFrom?: 'headline' | 'text'
}

const WORD = /[\p{L}][\p{L}\p{M}'’-]*/gu

/**
 * Names in a text, where a capitalised word opening a sentence other than the text's first is a name only
 * if it is also capitalised mid-sentence in the text, or is one of `known` (e.g. the headline's names).
 * "Laget reser i dag. Energi och fokus" → no "energi". The text's first word is kept: headlines and
 * teasers open with their subject ("Werner utvisad mot Degerfors").
 */
export function namesInSentences(text: string, known: Set<string> = new Set()): Set<string> {
  const opening = new Set<string>()
  const inside = new Set<string>()
  for (const m of text.matchAll(WORD)) {
    const before = text.slice(0, m.index).replace(/[\s"”“'’«»(]+$/u, '')
    const opensSentence = before !== '' && /[.!?…]$/u.test(before)
    for (const n of namesIn(m[0])) (opensSentence ? opening : inside).add(n)
  }
  return new Set([...inside, ...[...opening].filter(n => inside.has(n) || known.has(n))])
}

/**
 * Kinds of event, by the words reports use for them (folded, prefix-matched; phrases word by word). General
 * football and hockey vocabulary only: nothing names a person, club or article.
 */
export const EVENT_KINDS: Record<string, string[]> = {
  exit: ['sparka', 'sparken', 'avsked', 'entledig', 'bryter med', 'skiljs', 'skilja', 'tranarbyte', 'tranarskifte', 'petas', 'petad'],
  transfer: ['lamnar', 'flytt', 'overgang', 'skriver pa', 'skrivit pa', 'varvar', 'varvning', 'klar for', 'koper', 'saljer', 'utlanad'],
  contract: ['forlang', 'kontrakt'],
  injury: ['skada', 'skadad', 'opereras', 'opererad', 'rehab', 'tillbaka i traning'],
  national: ['landslag', 'forbundskapten', 'uttagen', 'uttagna', 'truppen'],
  result: ['vann', 'vinst', 'forlust', 'forlorade', 'kryss', 'oavgjort', 'mal', 'malet', 'rott kort', 'utvisad', 'utvisning', 'raddade', 'holl undan'],
  preview: ['infor', 'moter', 'gar for seger', 'startelva', 'laguttagning'],
  search: ['onskelista', 'aktuell', 'tranarjakt', 'kandidat', 'intresse', 'foljer', 'dementerar', 'ryktas'],
}

const words = (text: string) => [...text.matchAll(WORD)].flatMap(m => m[0].split(/[-–]/)).map(w => fold(w).replace(/[^a-z0-9]/g, '')).filter(Boolean)
const cue = (w: string, c: string) => (c.length < 5 ? w === c : w.startsWith(c))

/**
 * The kinds of event an article reports. From its headline by default: a teaser often recalls earlier
 * events as background ("the sacked coach…"), which is not what the article reports.
 */
export function eventKinds(a: SourceArticle, from: 'headline' | 'text' = 'headline'): Set<string> {
  const ws = words(from === 'headline' ? a.headline : `${a.headline} ${a.excerpt ?? ''}`)
  const kinds = new Set<string>()
  for (const [kind, cues] of Object.entries(EVENT_KINDS)) {
    const found = cues.some((c) => {
      const parts = c.split(' ')
      return ws.some((_, i) => parts.every((p, k) => !!ws[i + k] && cue(ws[i + k]!, p)))
    })
    if (found) kinds.add(kind)
  }
  return kinds
}

interface CProfile extends Profile { kinds: Set<string> }

function candidateProfile(a: SourceArticle, c: Candidate): CProfile {
  const p = profile(a)
  if (c.names === 'sentence') {
    const headline = namesInSentences(a.headline)
    p.names = new Set([...headline, ...namesInSentences(a.excerpt ?? '', headline)])
  }
  return { ...p, kinds: c.link !== 'names' ? eventKinds(a, c.kindsFrom) : new Set() }
}

/** The names linking two articles under a candidate, or null. */
export function candidateLink(p: CProfile, q: CProfile, c: Candidate): string[] | null {
  if (p.article.sport !== q.article.sport) return null
  if (Math.abs(p.time - q.time) > WINDOW_HOURS * 3_600_000) return null
  const shared = sharedNames(p, q)
  if (!shared.some(n => p.headlineTokens.has(n) && q.headlineTokens.has(n))) return null
  if (c.link === 'event-only') return [...p.kinds].some(k => q.kinds.has(k)) ? shared : null
  if (c.link === 'veto' && [...p.kinds].length && [...q.kinds].length && ![...p.kinds].some(k => q.kinds.has(k))) return null
  if (c.link === 'event' && p.kinds.size && q.kinds.size) {
    const same = [...p.kinds].some(k => q.kinds.has(k))
    return same ? shared : null
  }
  return shared.length >= MIN_SHARED ? shared : null
}

/** Same article from two feeds counts once; which copy is kept doesn't depend on input order. */
export function canonicalArticles(articles: SourceArticle[]): SourceArticle[] {
  const byUrl = new Map<string, SourceArticle>()
  const key = (a: SourceArticle) => `${a.id}\u0000${a.url}\u0000${a.sport}`
  for (const a of articles) {
    const u = canonicalUrl(a.url)
    const kept = byUrl.get(u)
    if (!kept || key(a) < key(kept)) byUrl.set(u, a)
  }
  return [...byUrl.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id))
}

export function groupWith(articles: SourceArticle[], c: Candidate): Story[] {
  const ps = canonicalArticles(articles).map(a => candidateProfile(a, c))
  const n = ps.length
  const links: (string[] | null)[][] = ps.map((p, i) => ps.map((q, j) => (i < j ? candidateLink(p, q, c) : null)))
  const link = (i: number, j: number) => (i < j ? links[i]![j] : links[j]![i])
  const cap = (c.spanHours ?? Infinity) * 3_600_000

  // Clusters as sorted member lists; the earliest member's index names a cluster.
  const of = ps.map((_, i) => i)
  const members = new Map<number, number[]>(ps.map((_, i) => [i, [i]]))
  const lo = ps.map(p => p.time)
  const hi = ps.map(p => p.time)
  const join = (a: number, b: number) => {
    const [keep, gone] = a < b ? [a, b] : [b, a]
    const all = [...members.get(keep)!, ...members.get(gone)!].sort((x, y) => x - y)
    for (const i of members.get(gone)!) of[i] = keep
    members.set(keep, all)
    members.delete(gone)
    lo[keep] = Math.min(lo[keep]!, lo[gone]!)
    hi[keep] = Math.max(hi[keep]!, hi[gone]!)
  }
  const fits = (a: number, b: number) => Math.max(hi[a]!, hi[b]!) - Math.min(lo[a]!, lo[b]!) <= cap

  if (c.cluster === 'single') {
    // Closest links first (in time, then by position), so a span cap keeps the tightest Story.
    const edges: [number, number][] = []
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (links[i]![j]) edges.push([i, j])
    edges.sort((x, y) => (ps[x[1]]!.time - ps[x[0]]!.time) - (ps[y[1]]!.time - ps[y[0]]!.time) || x[0] - y[0] || x[1] - y[1])
    for (const [i, j] of edges) {
      const a = of[i]!
      const b = of[j]!
      if (a !== b && fits(a, b)) join(a, b)
    }
  }
  else {
    // Repeatedly join the two clusters with the largest share of directly linked pairs, while it is at least
    // half; ties: the shorter combined span, then the earlier clusters.
    for (;;) {
      let best: { a: number, b: number, share: number, span: number } | undefined
      const ids = [...members.keys()].sort((x, y) => x - y)
      for (let x = 0; x < ids.length; x++) {
        for (let y = x + 1; y < ids.length; y++) {
          const a = ids[x]!
          const b = ids[y]!
          if (!fits(a, b)) continue
          let k = 0
          for (const i of members.get(a)!) for (const j of members.get(b)!) if (link(i, j)) k++
          if (!k) continue
          const share = k / (members.get(a)!.length * members.get(b)!.length)
          const span = Math.max(hi[a]!, hi[b]!) - Math.min(lo[a]!, lo[b]!)
          if (share < 0.5) continue
          if (!best || share > best.share || (share === best.share && span < best.span)) best = { a, b, share, span }
        }
      }
      if (!best) break
      join(best.a, best.b)
    }
  }

  // The names that linked members of the same Story directly.
  const edges = new Map<number, Set<string>>()
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shared = links[i]![j]
      if (!shared || of[i] !== of[j]) continue
      for (const k of [i, j]) edges.set(k, new Set([...(edges.get(k) ?? []), ...shared]))
    }
  }
  return toStories(ps, [...members.values()], edges)
}

export const CANDIDATES: Record<string, Candidate> = {
  'current': { names: 'current', link: 'names', cluster: 'single' },
  'majority + 36h': { names: 'current', link: 'names', cluster: 'majority', spanHours: 36 },
  'majority + 36h + sentence': { names: 'sentence', link: 'names', cluster: 'majority', spanHours: 36 },
  'event(text) + single + 36h': { names: 'sentence', link: 'event', cluster: 'single', spanHours: 36, kindsFrom: 'text' },
  'event + single + 36h': { names: 'sentence', link: 'event', cluster: 'single', spanHours: 36 },
  'event + single': { names: 'sentence', link: 'event', cluster: 'single' },
  'veto + single + 36h': { names: 'sentence', link: 'veto', cluster: 'single', spanHours: 36 },
  'event-only + single + 36h': { names: 'sentence', link: 'event-only', cluster: 'single', spanHours: 36 },
  'event + majority + 36h': { names: 'sentence', link: 'event', cluster: 'majority', spanHours: 36 },
}

