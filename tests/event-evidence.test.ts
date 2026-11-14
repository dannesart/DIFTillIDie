import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EVH_VERSION, evidence, judge } from '../server/lib/eventEvidence'
import { at, compiled, original } from './grouping-cases'

/*
 * EVH-1, the frozen event-identity hypothesis (Issue #25), on original synthetic headlines. These pin what the
 * hypothesis says; they do not claim it is right. Real-feed evaluation is private (docs/grouping-evidence.md).
 */

const pair = (a: Parameters<typeof compiled>[0], b: Parameters<typeof compiled>[0]) => judge(evidence(compiled(a)), evidence(original(b)))

describe('EVH-1 is frozen', () => {
  it('changing server/lib/eventEvidence.ts needs a new hypothesis version, not an edit of EVH-1', () => {
    const source = readFileSync(new URL('../server/lib/eventEvidence.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(EVH_VERSION).toBe('EVH-1')
    expect(createHash('sha256').update(source).digest('hex')).toBe('f282063f65645f1b7f4bc18c9d918026320770a6964d3d6da2f35decb7130cf3')
  })
})

describe('reported actions and background mentions', () => {
  it('reads a reported dismissal', () => {
    expect([...evidence(compiled({ headline: 'Norrvik sparkar tränaren Ekholm' })).reported]).toEqual(['dismissal'])
  })
  it('reads an attributive participle as background: "Norrviks sparkade tränare"', () => {
    const e = evidence(compiled({ headline: 'Norrviks sparkade tränare Ekholm aktuell i Vallby' }))
    expect(e.background.has('dismissal')).toBe(true)
    expect(e.reported.has('dismissal')).toBe(false)
    expect(e.reported.has('candidacy')).toBe(true)
  })
  it('reads "efter …" as background', () => {
    const e = evidence(compiled({ headline: 'Ekholm tar ny roll efter sparken' }))
    expect(e.background.has('dismissal')).toBe(true)
    expect(e.reported.size).toBe(0)
  })
  it('tells a headline speaker and a teaser speaker from a participant', () => {
    const e = evidence(compiled({ headline: 'Lund: ”Det var rätt beslut”', excerpt: 'Sportchefen Ola Lund förklarar varför Norrvik bryter med Tomas Ekholm.' }))
    expect(e.speakers.has('lund')).toBe(true)
    expect(e.participants.has('lund')).toBe(false)
    expect(e.participants.has('ekholm')).toBe(true)
  })
})

describe('pair judgements', () => {
  it('same action + the affected person: same', () => {
    expect(pair(
      { headline: 'Norrvik sparkar tränaren Tomas Ekholm', publishedAt: at(0) },
      { headline: 'Tomas Ekholm om sparken: ”Jag är besviken”', publishedAt: at(4) },
    ).verdict).toBe('same')
  })
  it('same action type, nothing specific shared: insufficient, never same', () => {
    expect(pair(
      { headline: 'Vallby sparkar Ivo Sand', publishedAt: at(0) },
      { headline: 'Kustby bryter med Leo Falk', publishedAt: at(2) },
    ).verdict).toBe('insufficient')
  })
  it('same person, incompatible reported actions: not same', () => {
    expect(pair(
      { headline: 'Lina Berg lämnar Djurgården för Vålerenga', publishedAt: at(0) },
      { headline: 'Lina Berg uttagen till landslaget', publishedAt: at(6) },
    ).verdict).toBe('not-same')
  })
  it('a club head-coach dismissal without a name: same (assumption A1)', () => {
    expect(pair(
      { headline: 'Djurgården bryter med tränaren Tomas Ekholm', publishedAt: at(0) },
      { headline: 'Expert om Djurgårdens tränarbyte: ”Rätt men sent”', publishedAt: at(3) },
    ).verdict).toBe('same')
  })
  it('a reaction that refers back, with the affected person: same', () => {
    expect(pair(
      { headline: 'Djurgården sparkar Tomas Ekholm', publishedAt: at(0) },
      { headline: 'Supportrarna delade om beskedet kring Tomas Ekholm', publishedAt: at(5) },
    ).verdict).toBe('same')
  })
  it('a shared person but no reported action on one side: insufficient', () => {
    expect(pair(
      { headline: 'Djurgården sparkar Tomas Ekholm', publishedAt: at(0) },
      { headline: 'Tomas Ekholm i nytt läge', publishedAt: at(5) },
    ).verdict).toBe('insufficient')
  })
  it('a misspelt name still anchors', () => {
    expect(pair(
      { headline: 'Djurgården sparkar Tomas Ekholmsson', publishedAt: at(0) },
      { headline: 'Ekholmson om sparken', excerpt: 'Ekholmson fick beskedet i dag.', publishedAt: at(2) },
    ).verdict).toBe('same')
  })
  it('a match preview and the result against the same opponent: not same', () => {
    expect(pair(
      { headline: 'Djurgården går för seger mot Vallby', publishedAt: at(0) },
      { headline: 'Djurgården föll mot Vallby', publishedAt: at(30) },
    ).verdict).toBe('not-same')
  })
  it('two reports of one result against the same opponent: same', () => {
    expect(pair(
      { headline: 'Utvisad Holm när Djurgården föll mot Vallby', publishedAt: at(0) },
      { headline: 'Förlust mot Vallby: ”Vi var för passiva”', publishedAt: at(2) },
    ).verdict).toBe('same')
  })
  it('a shared speaker only: not a match', () => {
    expect(pair(
      { headline: 'Lund: ”Vi går för seger mot Vallby”', excerpt: 'Ola Lund inför helgen.', publishedAt: at(0) },
      { headline: 'Lund om Strands skada', excerpt: 'Ola Lund säger att Strand är skadad.', publishedAt: at(3) },
    ).verdict).not.toBe('same')
  })
  it('articles too far apart are never the same', () => {
    expect(pair(
      { headline: 'Norrvik sparkar tränaren Tomas Ekholm', publishedAt: at(0) },
      { headline: 'Tomas Ekholm om sparken', publishedAt: at(60) },
    ).verdict).toBe('not-same')
  })
})
