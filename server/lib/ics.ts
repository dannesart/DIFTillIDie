/*
 * Just enough iCalendar (RFC 5545) parsing for a club match calendar:
 * line unfolding, VEVENT properties, text unescaping, and "floating"
 * local times interpreted in a given IANA timezone.
 */

export interface IcsEvent {
  uid?: string
  summary?: string
  location?: string
  description?: string
  url?: string
  /** Raw DTSTART value, e.g. "20261108T140000" or "20261108T130000Z". */
  dtstart?: string
  /** TZID parameter on DTSTART, if any. */
  tzid?: string
}

export interface IcsCalendar {
  /** X-WR-TIMEZONE / TIMEZONE-ID: how to read floating times. */
  timezone?: string
  events: IcsEvent[]
}

export function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim()
}

export function parseIcs(text: string): IcsCalendar {
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Svaret är inte en iCalendar-fil')
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const cal: IcsCalendar = { events: [] }
  let ev: IcsEvent | null = null
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const [name = '', ...params] = line.slice(0, colon).split(';')
    const value = line.slice(colon + 1)
    const key = name.toUpperCase()
    if (key === 'BEGIN' && value === 'VEVENT') ev = {}
    else if (key === 'END' && value === 'VEVENT') {
      if (ev) cal.events.push(ev)
      ev = null
    }
    else if (!ev) {
      if (key === 'X-WR-TIMEZONE' || key === 'TIMEZONE-ID') cal.timezone ??= value.trim()
    }
    else if (key === 'UID') ev.uid = value.trim()
    else if (key === 'SUMMARY') ev.summary = unescapeText(value)
    else if (key === 'LOCATION') ev.location = unescapeText(value)
    else if (key === 'DESCRIPTION') ev.description = unescapeText(value)
    else if (key === 'URL') ev.url = value.trim()
    else if (key === 'DTSTART') {
      ev.dtstart = value.trim()
      ev.tzid = params.find(p => p.toUpperCase().startsWith('TZID='))?.slice(5)
    }
  }
  return cal
}

/** Offset of `timeZone` from UTC at the instant `utcMs`, in ms. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs
}

/** Wall-clock time in `timeZone` → UTC instant (DST-aware). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  let utc = guess - zoneOffset(guess, timeZone)
  // Re-check at the corrected instant, which matters right around DST changes.
  utc = guess - zoneOffset(utc, timeZone)
  return new Date(utc)
}

/** DTSTART → UTC Date. Floating times are read in the TZID, else the calendar's timezone. */
export function eventStart(ev: IcsEvent, calendarTz = 'Europe/Stockholm'): Date | null {
  const m = ev.dtstart?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', , z] = m
  if (z) return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi))
  return zonedToUtc(+y!, +mo!, +d!, +h, +mi, ev.tzid || calendarTz)
}
