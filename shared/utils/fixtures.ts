import type { Fixture, Sport } from '../types/domain'

const DIF = /^djurg[aå]rden/i

export const isAway = (f: Fixture) => !DIF.test(f.home)

export const teamLabel = (f: Pick<Fixture, 'team'>) => (f.team === 'herr' ? 'Herrar' : 'Damer')

/**
 * The next match to count down to: the earliest fixture that hasn't
 * started yet, optionally for one sport. A fixture at exactly `now` has
 * started, so it is never "next".
 */
export function nextFixture(fixtures: Fixture[], now: number, sport: 'alla' | Sport = 'alla'): Fixture | undefined {
  return fixtures
    .filter(f => (sport === 'alla' || f.sport === sport) && Date.parse(f.kickoff) > now)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))[0]
}

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Fold lines longer than 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let current = ''
  for (const ch of line) {
    if (new TextEncoder().encode(current + ch).length > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
    }
    current += ch
  }
  out.push(current)
  return out.join('\r\n ')
}

/** A calendar file for one verified fixture. Times are UTC, so every calendar app reads them right. */
export function fixtureIcs(f: Fixture, now = new Date()): string {
  const start = new Date(f.kickoff)
  const end = new Date(start.getTime() + (f.sport === 'hockey' ? 150 : 120) * 60_000)
  const sourceNote = f.source === 'manual'
    ? `Manuellt verifierad mot den officiella sidan ${f.verifiedAt ?? ''}.`.replace(' .', '.')
    : 'Från Djurgårdens officiella matchkalender på dif.se.'
  const description = [
    `${teamLabel(f)} · ${f.competition}${isAway(f) ? ' · Bortamatch' : ' · Hemmamatch'}`,
    f.preliminary ? 'Preliminär tid och datum.' : '',
    sourceNote,
    `Officiell matchinfo: ${f.officialUrl}`,
  ].filter(Boolean).join('\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Djurgarn tills jag dor//SV',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${f.id}@djurgarn-tills-jag-dor`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(`${f.home} – ${f.away} (${f.competition}, ${teamLabel(f)})`)}`,
    f.venue ? `LOCATION:${icsText(f.venue)}` : '',
    `DESCRIPTION:${icsText(description)}`,
    `URL:${f.officialUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).map(fold).join('\r\n')
}
