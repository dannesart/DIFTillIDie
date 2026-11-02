import type { Fixture, FixturesResponse, FixtureTeam, FeedStatus } from '../../shared/types/domain'
import { eventStart, parseIcs } from './ics'
import type { IcsEvent } from './ics'

/*
 * Real fixtures, from where the clubs actually publish them:
 *
 *  - Football (men & women): dif.se's public match-calendar subscription,
 *    the same iCalendar link the club offers supporters on dif.se/matcher.
 *  - Hockey (men): no public machine-readable schedule exists (difhockey.se
 *    and shl.se only offer a personal ECAL sign-up widget), so fixtures are
 *    entered by hand after checking difhockey.se, and labelled as such.
 *  - Hockey (women, SDHL): no verified fixtures yet — shown as such in the UI.
 *
 * Academy fixtures are never mixed in: we only request the club's
 * "herrar" and "damer" calendars and only keep known first-team competitions.
 */

export const DIF_CALENDAR = {
  id: 'dif-kalender',
  outlet: 'dif.se matchkalender',
  publisher: 'Djurgårdens IF Fotboll',
  homepage: 'https://www.dif.se/matcher',
  url: (category: 'herrar' | 'damer') => `https://www.dif.se/api/calendar?category=${category}`,
} as const

export const HOCKEY_SCHEDULE_URL = 'https://www.difhockey.se/game-schedule'

/**
 * Competitions we know are first-team football. Anything else in the
 * calendar (e.g. "Ligacupen Elit", whose level we haven't verified) is left out.
 */
export const FIRST_TEAM_COMPETITIONS: Record<'herrar' | 'damer', string[]> = {
  herrar: ['Allsvenskan', 'Svenska cupen herr', 'Träningsmatch herr'],
  damer: ['Obos Damallsvenskan', 'Svenska cupen dam', 'Träningsmatch dam'],
}

/** How the calendar names competitions → how we show them. */
const COMPETITION_LABEL: Record<string, string> = {
  'Obos Damallsvenskan': 'OBOS Damallsvenskan',
  'Svenska cupen herr': 'Svenska cupen',
  'Svenska cupen dam': 'Svenska cupen',
  'Träningsmatch herr': 'Träningsmatch',
  'Träningsmatch dam': 'Träningsmatch',
}

/**
 * Hand-maintained, verified fixtures for teams without a machine-readable
 * schedule. Each entry says when and where it was checked. Past entries
 * drop out automatically; add new ones after checking the official page.
 */
export const MANUAL_FIXTURES: Fixture[] = [
  {
    id: 'manual-hockey-herr-2026-11-12-farjestad',
    sport: 'hockey',
    team: 'herr',
    competition: 'SHL',
    home: 'Färjestad BK',
    away: 'Djurgården',
    venue: 'Löfbergs Arena',
    // 12 Nov 2026 19:00 Europe/Stockholm (CET, UTC+1)
    kickoff: '2026-11-12T18:00:00.000Z',
    preliminary: false,
    source: 'manual',
    verifiedAt: '2026-11-02',
    officialUrl: HOCKEY_SCHEDULE_URL,
    ticketsUrl: 'https://www.difhockey.se/bortabiljetter',
  },
]

/** The teams we follow, and how — shown in the UI so nothing is silently left out. */
export const TEAM_SCOPE: FixturesResponse['scope'] = [
  { sport: 'fotboll', team: 'herr', label: 'Fotboll herr', coverage: 'automatic' },
  { sport: 'fotboll', team: 'dam', label: 'Fotboll dam', coverage: 'automatic' },
  { sport: 'hockey', team: 'herr', label: 'Hockey herr', coverage: 'manual' },
  { sport: 'hockey', team: 'dam', label: 'Hockey dam (SDHL)', coverage: 'none' },
]

const DJURGARDEN = /^djurg[aå]rden(s if)?$/i
// "(trupp annonserad)" etc. — status notes in the summary, not part of the match.
const STATUS_NOTE = /\s*\((trupp annonserad|preliminär tid och datum)\)/gi

/**
 * "Halmstads BK - Djurgården (Allsvenskan)" → home/away/competition.
 * Returns null for anything that isn't a Djurgården match in a known first-team competition.
 */
export function toFixture(ev: IcsEvent, team: 'herrar' | 'damer', calendarTz?: string): Fixture | null {
  if (!ev.summary) return null
  const competition = ev.summary.match(/\(([^()]+)\)\s*$/)?.[1]?.trim()
  if (!competition || !FIRST_TEAM_COMPETITIONS[team].includes(competition)) return null
  const preliminary = /\(preliminär tid och datum\)/i.test(ev.summary)
  const title = ev.summary.slice(0, ev.summary.lastIndexOf('(')).replace(STATUS_NOTE, '').trim()
  const [home, away, ...rest] = title.split(/\s+[-–]\s+/).map(s => s.trim())
  if (!home || !away || rest.length) return null
  const homeIsDif = DJURGARDEN.test(home)
  if (!homeIsDif && !DJURGARDEN.test(away)) return null
  const kickoff = eventStart(ev, calendarTz)
  if (!kickoff) return null
  const fixtureTeam: FixtureTeam = team === 'herrar' ? 'herr' : 'dam'
  return {
    id: ev.uid ? `dif-${ev.uid}` : `dif-${fixtureTeam}-${kickoff.toISOString()}`,
    sport: 'fotboll',
    team: fixtureTeam,
    competition: COMPETITION_LABEL[competition] ?? competition,
    home,
    away,
    venue: ev.location || undefined,
    kickoff: kickoff.toISOString(),
    preliminary,
    source: 'dif-kalender',
    officialUrl: ev.url || DIF_CALENDAR.homepage,
  }
}

export function fixturesFromIcs(text: string, team: 'herrar' | 'damer'): { fixtures: Fixture[], eventCount: number } {
  const cal = parseIcs(text)
  const fixtures = cal.events.map(ev => toFixture(ev, team, cal.timezone)).filter((f): f is Fixture => !!f)
  return { fixtures, eventCount: cal.events.length }
}

export interface FixturesState {
  value?: { fixtures: Fixture[], status: FeedStatus }
}

/**
 * Fetch both football calendars and add the manual hockey fixtures.
 * Never throws; on failure keeps the last good football fixtures (stale).
 */
export async function loadFixtures(opts: { lastGood: FixturesState, fetcher?: typeof fetch, timeoutMs?: number, now?: number }): Promise<FixturesResponse> {
  const { fetcher = fetch, timeoutMs = 8000, now = Date.now() } = opts
  const base = { id: DIF_CALENDAR.id, outlet: DIF_CALENDAR.outlet, publisher: DIF_CALENDAR.publisher, homepage: DIF_CALENDAR.homepage, sport: 'fotboll' as const }
  let football: Fixture[]
  let status: FeedStatus
  try {
    const results = await Promise.all((['herrar', 'damer'] as const).map(async (team) => {
      let res: Response
      try {
        res = await fetcher(DIF_CALENDAR.url(team), {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'accept': 'text/calendar', 'user-agent': 'DjurgarnTillsJagDor/0.4 (+https://github.com/dannesart/DIFTillIDie)' },
        })
      }
      catch (e) {
        const err = e as Error
        throw new Error(err.name === 'TimeoutError' || err.name === 'AbortError' ? `Tidsgräns (${timeoutMs} ms)` : `Nätverksfel: ${err.message}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return fixturesFromIcs(await res.text(), team)
    }))
    football = results.flatMap(r => r.fixtures)
    status = { ...base, ok: true, stale: false, fetchedAt: new Date(now).toISOString(), itemCount: results.reduce((n, r) => n + r.eventCount, 0), relevantCount: football.length }
    opts.lastGood.value = { fixtures: football, status }
  }
  catch (e) {
    const error = (e as Error).message
    const previous = opts.lastGood.value
    football = previous?.fixtures ?? []
    status = previous
      ? { ...previous.status, ok: false, stale: true, error }
      : { ...base, ok: false, stale: false, fetchedAt: null, itemCount: 0, relevantCount: 0, error }
  }
  // Only upcoming fixtures leave the server; the client re-checks against its own clock.
  const fixtures = [...football, ...MANUAL_FIXTURES]
    .filter(f => Date.parse(f.kickoff) > now)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
  return { fixtures, status, scope: TEAM_SCOPE, generatedAt: new Date(now).toISOString() }
}
