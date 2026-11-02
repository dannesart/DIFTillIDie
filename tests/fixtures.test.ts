import { describe, expect, it } from 'vitest'
import type { Fixture } from '../shared/types/domain'
import { eventStart, parseIcs, zonedToUtc } from '../server/lib/ics'
import { MANUAL_FIXTURES, TEAM_SCOPE, fixturesFromIcs, loadFixtures, toFixture } from '../server/lib/fixtures'
import { fixtureIcs, isAway, nextFixture, teamLabel } from '../shared/utils/fixtures'
import { parseIcs as parseOwnIcs } from '../server/lib/ics'
import { fakeFetch } from './helpers'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Trimmed copies of dif.se's real calendars, captured 2026-11-02. */
const cal = (team: 'herrar' | 'damer') => readFileSync(fileURLToPath(new URL(`./fixtures/dif-kalender-${team}.ics`, import.meta.url)), 'utf8')
const NOW = Date.parse('2026-11-02T16:00:00Z')

describe('iCalendar parsing', () => {
  it('unfolds lines and reads the calendar timezone', () => {
    const c = parseIcs(cal('herrar'))
    expect(c.timezone).toBe('Europe/Stockholm')
    expect(c.events.some(e => e.summary === 'Djurgården - Viking FK (preliminär tid och datum) (Träningsmatch herr)')).toBe(true)
  })

  it('unescapes text values', () => {
    const c = parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:A\\, B\\; C\r\nDESCRIPTION:Rad 1\\nRad 2\r\nEND:VEVENT\r\nEND:VCALENDAR')
    expect(c.events[0]).toMatchObject({ summary: 'A, B; C', description: 'Rad 1\nRad 2' })
  })

  it('rejects things that are not calendars', () => {
    expect(() => parseIcs('<html>nope</html>')).toThrow(/iCalendar/)
  })
})

describe('Europe/Stockholm times', () => {
  it('reads floating times as Swedish wall-clock time, winter and summer', () => {
    expect(zonedToUtc(2026, 11, 8, 14, 0, 'Europe/Stockholm').toISOString()).toBe('2026-11-08T13:00:00.000Z') // CET +1
    expect(zonedToUtc(2026, 6, 18, 11, 0, 'Europe/Stockholm').toISOString()).toBe('2026-06-18T09:00:00.000Z') // CEST +2
  })

  it('gets the days around the switch to winter time right (25 Oct 2026)', () => {
    expect(zonedToUtc(2026, 10, 24, 19, 0, 'Europe/Stockholm').toISOString()).toBe('2026-10-24T17:00:00.000Z')
    expect(zonedToUtc(2026, 10, 25, 19, 0, 'Europe/Stockholm').toISOString()).toBe('2026-10-25T18:00:00.000Z')
  })

  it('honours explicit UTC and TZID times', () => {
    expect(eventStart({ dtstart: '20261108T130000Z' })!.toISOString()).toBe('2026-11-08T13:00:00.000Z')
    expect(eventStart({ dtstart: '20261108T140000', tzid: 'Europe/London' })!.toISOString()).toBe('2026-11-08T14:00:00.000Z')
  })

  it('matches the hand-verified hockey puck drop (12 Nov 19:00 in Karlstad)', () => {
    expect(MANUAL_FIXTURES[0]!.kickoff).toBe(zonedToUtc(2026, 11, 12, 19, 0, 'Europe/Stockholm').toISOString())
  })
})

describe('dif.se calendar → fixtures', () => {
  const men = fixturesFromIcs(cal('herrar'), 'herrar').fixtures
  const women = fixturesFromIcs(cal('damer'), 'damer').fixtures

  it('reads the verified Allsvenskan away game in the right order', () => {
    const f = men.find(x => x.home === 'Halmstads BK')!
    expect(f).toMatchObject({
      sport: 'fotboll', team: 'herr', competition: 'Allsvenskan',
      home: 'Halmstads BK', away: 'Djurgården', venue: 'Örjans Vall',
      kickoff: '2026-11-08T13:00:00.000Z', preliminary: false, source: 'dif-kalender',
      officialUrl: 'https://www.dif.se/matcher',
    })
    expect(isAway(f)).toBe(true)
  })

  it('reads the verified Damallsvenskan home game', () => {
    const f = women.find(x => x.away === 'BK Häcken')!
    expect(f).toMatchObject({ team: 'dam', competition: 'OBOS Damallsvenskan', home: 'Djurgården', venue: 'Kristinebergs IP', kickoff: '2026-11-06T17:00:00.000Z' })
    expect(isAway(f)).toBe(false)
    expect(teamLabel(f)).toBe('Damer')
  })

  it('strips status notes and flags preliminary times', () => {
    const viking = men.find(x => x.away === 'Viking FK')!
    expect(viking.preliminary).toBe(true)
    expect(viking.competition).toBe('Träningsmatch')
    expect(men.find(x => x.home === 'Brommapojkarna')!.home).toBe('Brommapojkarna') // "(trupp annonserad)" gone
  })

  it('leaves out competitions not verified as first-team (Ligacupen Elit)', () => {
    expect(men.some(f => f.competition.includes('Ligacupen'))).toBe(false)
    expect(toFixture({ summary: 'Djurgården - AIK (Allsvenskan U21)', dtstart: '20261108T140000' }, 'herrar')).toBeNull()
  })

  it('ignores events that are not a Djurgården match', () => {
    expect(toFixture({ summary: 'AIK - Hammarby (Allsvenskan)', dtstart: '20261108T140000' }, 'herrar')).toBeNull()
    expect(toFixture({ summary: 'Träning (Allsvenskan)', dtstart: '20261108T140000' }, 'herrar')).toBeNull()
  })
})

describe('nextFixture', () => {
  const all: Fixture[] = [
    ...fixturesFromIcs(cal('herrar'), 'herrar').fixtures,
    ...fixturesFromIcs(cal('damer'), 'damer').fixtures,
    ...MANUAL_FIXTURES,
  ]

  it('Allt picks the earliest upcoming match across teams (women, 6 Nov)', () => {
    expect(nextFixture(all, NOW)).toMatchObject({ home: 'Djurgården', away: 'BK Häcken', team: 'dam' })
  })

  it('Fotboll and Hockey filter correctly', () => {
    expect(nextFixture(all, NOW, 'fotboll')!.sport).toBe('fotboll')
    expect(nextFixture(all, NOW, 'hockey')).toMatchObject({ home: 'Färjestad BK', away: 'Djurgården', competition: 'SHL', venue: 'Löfbergs Arena', source: 'manual' })
  })

  it('never returns a match that has started', () => {
    const atKickoff = Date.parse('2026-11-06T17:00:00.000Z')
    expect(nextFixture(all, atKickoff - 1)!.away).toBe('BK Häcken')
    expect(nextFixture(all, atKickoff)!.home).toBe('Halmstads BK')
  })

  it('is empty rather than inventing a match', () => {
    expect(nextFixture(all, Date.parse('2027-06-01T00:00:00Z'))).toBeUndefined()
    expect(nextFixture([], NOW)).toBeUndefined()
    expect(nextFixture(all.filter(f => f.sport === 'fotboll'), NOW, 'hockey')).toBeUndefined()
  })
})

describe('loadFixtures', () => {
  const byCategory: typeof fetch = async (url) => new Response(cal(String(url).endsWith('damer') ? 'damer' : 'herrar'))

  it('combines both calendars with the manual hockey fixture, upcoming only, earliest first', async () => {
    const r = await loadFixtures({ lastGood: {}, fetcher: byCategory, now: NOW })
    expect(r.status).toMatchObject({ ok: true, stale: false })
    expect(r.fixtures.map(f => `${f.home} – ${f.away}`)).toEqual([
      'Djurgården – BK Häcken',
      'Halmstads BK – Djurgården',
      'Färjestad BK – Djurgården',
      'Eskilstuna United – Djurgården',
      'IK Sirius – Djurgården',
      'Djurgården – BK Häcken',
    ])
    expect(r.fixtures.every(f => Date.parse(f.kickoff) > NOW)).toBe(true)
  })

  it('states the team scope, including what is not covered', async () => {
    const r = await loadFixtures({ lastGood: {}, fetcher: byCategory, now: NOW })
    expect(r.scope).toEqual(TEAM_SCOPE)
    expect(r.scope.find(s => s.label.includes('SDHL'))!.coverage).toBe('none')
  })

  it('keeps the hand-verified hockey match when dif.se is down', async () => {
    const r = await loadFixtures({ lastGood: {}, fetcher: fakeFetch('', { status: 503 }), now: NOW })
    expect(r.status).toMatchObject({ ok: false, stale: false, error: 'HTTP 503' })
    expect(r.fixtures.map(f => f.sport)).toEqual(['hockey'])
  })

  it('serves the last good football fixtures, marked stale, after a failure', async () => {
    const lastGood = {}
    await loadFixtures({ lastGood, fetcher: byCategory, now: NOW })
    const r = await loadFixtures({ lastGood, fetcher: fakeFetch('<html>oops</html>'), now: NOW })
    expect(r.status).toMatchObject({ ok: false, stale: true })
    expect(r.fixtures.some(f => f.home === 'Halmstads BK')).toBe(true)
  })

  it('drops manual fixtures once they have started', async () => {
    const r = await loadFixtures({ lastGood: {}, fetcher: byCategory, now: Date.parse('2026-11-12T18:00:00Z') })
    expect(r.fixtures.some(f => f.source === 'manual')).toBe(false)
  })
})

describe('calendar download', () => {
  const halmstad = fixturesFromIcs(cal('herrar'), 'herrar').fixtures.find(f => f.home === 'Halmstads BK')!
  const ics = fixtureIcs(halmstad, new Date('2026-11-02T16:00:00Z'))
  const event = parseOwnIcs(ics).events[0]!

  it('contains the verified match details in UTC', () => {
    expect(event.summary).toBe('Halmstads BK – Djurgården (Allsvenskan, Herrar)')
    expect(event.location).toBe('Örjans Vall')
    expect(event.dtstart).toBe('20261108T130000Z')
    expect(eventStart(event)!.toISOString()).toBe(halmstad.kickoff)
    expect(event.url).toBe('https://www.dif.se/matcher')
    expect(event.description).toContain('Bortamatch')
    expect(event.description).toContain('officiella matchkalender på dif.se')
  })

  it('has no trace of demo content and folds long lines', () => {
    expect(ics).not.toMatch(/demo/i)
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })

  it('says when a fixture was verified by hand', () => {
    const e = parseOwnIcs(fixtureIcs(MANUAL_FIXTURES[0]!)).events[0]!
    expect(e.summary).toBe('Färjestad BK – Djurgården (SHL, Herrar)')
    expect(e.description).toContain('Manuellt verifierad mot den officiella sidan 2026-11-02')
    expect(e.url).toBe('https://www.difhockey.se/game-schedule')
  })
})
