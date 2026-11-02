const TZ = 'Europe/Stockholm'
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export function timeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  if (diff < MIN) return 'nyss'
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} tim`
  const days = Math.floor(diff / DAY)
  return days === 1 ? 'i går' : `${days} dagar`
}

/** Stable on server and client: always rendered in Stockholm time. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function kickoffLabel(iso: string): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
  return `${day} · ${clockTime(iso).replace(':', '.')}`
}

export function stockholmHour(now: number): number {
  return Number(new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)))
}

export type DayPart = 'morgon' | 'dag' | 'kvall' | 'natt'

export function dayPart(now: number): DayPart {
  const h = stockholmHour(now)
  if (h >= 5 && h < 10) return 'morgon'
  if (h >= 10 && h < 18) return 'dag'
  if (h >= 18 && h < 23) return 'kvall'
  return 'natt'
}

export function countdown(targetIso: string, now: number) {
  const diff = Math.max(0, new Date(targetIso).getTime() - now)
  return {
    dagar: Math.floor(diff / DAY),
    timmar: Math.floor((diff % DAY) / HOUR),
    minuter: Math.floor((diff % HOUR) / MIN),
    sekunder: Math.floor((diff % MIN) / 1000),
  }
}

/** Djurgårdens IF was founded on 12 March 1891. */
export const FOUNDED = Date.UTC(1891, 2, 12)

export function daysSinceFounding(now: number): number {
  return Math.floor((now - FOUNDED) / DAY)
}
