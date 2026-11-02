import type { Sport } from '#shared/types/domain'

/* DEMO: invented upcoming matches, placed relative to "now". */

export interface Fixture {
  sport: Sport
  opponent: string
  venue: string
  competition: string
  kickoff: string
}

const HOUR = 3_600_000

export function buildDemoFixtures(now: number): Fixture[] {
  const nextHour = Math.ceil(now / HOUR) * HOUR
  return [
    { sport: 'hockey', opponent: 'Färjestad', venue: 'Hovet', competition: 'SHL', kickoff: new Date(nextHour + 29 * HOUR).toISOString() },
    { sport: 'fotboll', opponent: 'AIK', venue: 'Tele2 Arena', competition: 'Allsvenskan', kickoff: new Date(nextHour + 53 * HOUR).toISOString() },
  ]
}
