import type { SupabaseClient } from '@supabase/supabase-js'
import { ref, watch } from 'vue'
import type { AuthStore } from './auth'

/*
 * Matchtipset in the browser: a supporter's view of the pilot, over the
 * database's own functions (supabase/migrations/…_matchtipset_foundation,
 * docs/matchtipset.md). Everything shown comes from them: real, verified
 * matches only, the database's deadline, its effective picks, its points.
 * Nothing is invented here, and nothing is decided here that the database
 * decides (whether a tip is in time, who sees what, what it scores).
 *
 * Signed in only: a guest triggers no request at all. Joining is always an
 * explicit act (join()), never a side effect of visiting.
 *
 * Framework-free so it can be tested with a fake client; the page creates
 * one per visit (useMatchtips).
 */

/** The pilot: DIF men's SHL regular season, from the first match after it opens. */
export const PILOT_SEASON = '2026/27'
export const SIXTY_MINUTES = 'Tippa resultatet efter 60 minuter. Förlängning och straffar räknas inte.'
export const MAX_GOALS = 30

export type DecidedIn = 'regulation' | 'overtime' | 'shootout'

export interface TipMatch {
  id: string
  season: string
  homeTeam: string
  awayTeam: string
  scheduledStart: string
  /** The database's deadline; null while the match is paused (postponed before it, no new date). */
  locksAt: string | null
  /** The database's own "has it locked", as of when it was read. */
  locked: boolean
  status: 'scheduled' | 'postponed' | 'void'
  voidReason: string | null
  result: { home: number, away: number, decidedIn: DecidedIn, revision: number, sourceUrl: string | null, note: string | null } | null
  deadlineCorrection: { reason: string | null, sourceUrl: string | null } | null
  officialUrl: string
}

export interface MyPick {
  matchId: string
  /** The pick that counts (null: none, e.g. the only one came after a corrected deadline). */
  pick: { home: number, away: number } | null
  points: number | null
  latest: { home: number, away: number, submittedAt: string }
  /** false: the latest submission doesn't count, because the deadline was corrected to before it. */
  latestCounts: boolean
}

export interface PublicPick { handle: string, home: number, away: number, points: number | null }
export interface Standing { rank: number, handle: string, points: number, tipped: number, exact: number, outcomes: number }

/** What a match card shows. Derived from the database's state; the clock only closes the form early. */
export type MatchPhase = 'open' | 'paused' | 'locked' | 'postponed' | 'settled' | 'void'

export function matchPhase(m: TipMatch, now = Date.now()): MatchPhase {
  if (m.status === 'void') return 'void'
  if (m.locksAt === null) return 'paused'
  if (!m.locked && Date.parse(m.locksAt) > now) return 'open'
  if (m.status === 'postponed') return 'postponed'
  return m.result ? 'settled' : 'locked'
}

/* ── Row shapes, as the functions return them ─────────────────────────── */
interface MatchRow {
  id: string, season: string, home_team: string, away_team: string,
  scheduled_start: string, locks_at: string | null, locked: boolean | null,
  status: TipMatch['status'], void_reason: string | null,
  result_home_60: number | null, result_away_60: number | null, decided_in: DecidedIn | null, result_revision: number,
  result_source_url: string | null, result_note: string | null,
  deadline_corrected: boolean, deadline_correction_reason: string | null, deadline_correction_source_url: string | null,
  official_url: string
}
interface MyPickRow { match_id: string, pick_home: number | null, pick_away: number | null, points: number | null, latest_home: number, latest_away: number, latest_submitted_at: string, latest_counts: boolean }
interface PickRow { handle: string, pick_home: number, pick_away: number, points: number | null }
interface StandingRow { rank: number | string, handle: string, points: number | string, matches_tipped: number | string, exact_scores: number | string, correct_outcomes: number | string }

export function toMatch(r: MatchRow): TipMatch {
  return {
    id: r.id,
    season: r.season,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    scheduledStart: r.scheduled_start,
    locksAt: r.locks_at,
    locked: !!r.locked,
    status: r.status,
    voidReason: r.void_reason,
    result: r.result_home_60 === null || r.result_away_60 === null || !r.decided_in
      ? null
      : { home: r.result_home_60, away: r.result_away_60, decidedIn: r.decided_in, revision: r.result_revision, sourceUrl: r.result_source_url, note: r.result_note },
    deadlineCorrection: r.deadline_corrected ? { reason: r.deadline_correction_reason, sourceUrl: r.deadline_correction_source_url } : null,
    officialUrl: r.official_url,
  }
}

export function toMyPick(r: MyPickRow): MyPick {
  return {
    matchId: r.match_id,
    pick: r.pick_home === null || r.pick_away === null ? null : { home: r.pick_home, away: r.pick_away },
    points: r.points,
    latest: { home: r.latest_home, away: r.latest_away, submittedAt: r.latest_submitted_at },
    latestCounts: r.latest_counts,
  }
}

/* bigint columns may arrive as strings: numbers here. */
export const toStanding = (r: StandingRow): Standing => ({
  rank: Number(r.rank), handle: r.handle, points: Number(r.points),
  tipped: Number(r.matches_tipped), exact: Number(r.exact_scores), outcomes: Number(r.correct_outcomes),
})

/* ── Words ─────────────────────────────────────────────────────────────── */
const when = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' })
const clock = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' })

/** "tors 12 nov. 19:00", Swedish time, whatever the device's zone. */
export const formatWhen = (iso: string) => when.format(new Date(iso))
export const formatClock = (iso: string) => clock.format(new Date(iso))

export const score = (s: { home: number, away: number }) => `${s.home}–${s.away}`

export function decidedLabel(d: DecidedIn): string {
  if (d === 'overtime') return 'Oavgjort efter 60 – avgjord i förlängning'
  if (d === 'shootout') return 'Oavgjort efter 60 – avgjord på straffar'
  return 'Avgjord efter 60 minuter'
}

/** No result yet is never "0 poäng". */
export function pointsLabel(points: number | null): string {
  if (points === null) return 'Väntar på resultat'
  if (points === 3) return '3 poäng – exakt rätt'
  if (points === 1) return '1 poäng – rätt utgång'
  return '0 poäng'
}

/**
 * Only to the supporter themselves, when their latest tip came after a
 * corrected deadline. They couldn't have known: it was open as published.
 */
export function lateNote(p: MyPick, m: TipMatch): string | null {
  if (p.latestCounts) return null
  const at = m.locksAt ? ` (${formatClock(m.locksAt)})` : ''
  const kept = p.pick ? `Ditt tidigare tips ${score(p.pick)} gäller.` : 'Du har inget tidigare tips som räknas för den här matchen.'
  return `Räknas inte – matchens starttid har rättats. Ditt tips ${score(p.latest)} kom efter den rättade deadlinen${at}, fast tippningen var öppen när du lämnade det. ${kept}`
}

/** A goals field: a whole number from 0 to 30, or null. */
export function parseGoals(input: string | number): number | null {
  const s = String(input).trim()
  if (!/^\d{1,2}$/.test(s)) return null
  const n = Number(s)
  return n <= MAX_GOALS ? n : null
}

interface DataError { code?: string, message?: string }
const NETWORK = 'Ingen kontakt med servern. Kolla uppkopplingen och försök igen.'
const isNetwork = (e: unknown) => e instanceof TypeError || /failed to fetch|network|load failed|fetch failed/i.test(String((e as DataError)?.message ?? e))
/** A database without the Matchtipset functions (e.g. a local database before the migration). */
const missingFunction = (e: unknown) => ['PGRST202', '42883'].includes((e as DataError | null)?.code ?? '')

/** The database's refusals, in Swedish. */
export function submitErrorMessage(e: unknown): string {
  const code = (e as DataError | null)?.code
  if (code === '55000') return 'Tippningen för matchen är stängd. Deadlinen är den som gäller här nedan.'
  if (code === '42501') return 'Du behöver vara med i Matchtipset för att tippa.'
  if (code === '22023') return `Fyll i hela mål, från 0 till ${MAX_GOALS}.`
  if (code === '54000') return 'Du har ändrat tipset för många gånger för den här matchen.'
  if (code === 'P0002') return 'Matchen finns inte längre.'
  if (isNetwork(e)) return NETWORK
  return 'Tipset kunde inte sparas. Försök igen.'
}

/* ── The store ─────────────────────────────────────────────────────────── */
export type MatchtipsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'signed-out' | 'unavailable'

export function createMatchtips(client: SupabaseClient | null, auth: Pick<AuthStore, 'status' | 'userId'> | null, options: { season?: string } = {}) {
  const season = options.season ?? PILOT_SEASON
  const status = ref<MatchtipsStatus>('idle')
  const participating = ref(false)
  const optedInAt = ref<string | null>(null)
  /** The consent text version joining requires (from the database). */
  const consentVersion = ref<string | null>(null)
  const matches = ref<TipMatch[]>([])
  const myPicks = ref<Record<string, MyPick>>({})
  const standings = ref<Standing[]>([])
  /** Everyone's effective picks for a locked match, fetched when asked. */
  const picks = ref<Record<string, PublicPick[] | 'loading' | 'error'>>({})
  const joining = ref(false)
  const leaving = ref(false)
  /** Which match's tip is being saved. */
  const saving = ref<string | null>(null)
  /** Per match: the outcome of the last save. */
  const notes = ref<Record<string, { ok: boolean, text: string }>>({})
  const error = ref<string | null>(null)
  let request = 0

  const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error: e } = await client!.rpc(fn, args)
    if (e) throw e
    return data as T
  }

  function reset() {
    request++
    participating.value = false
    optedInAt.value = null
    matches.value = []
    myPicks.value = {}
    standings.value = []
    picks.value = {}
    notes.value = {}
    error.value = null
  }

  async function load() {
    if (!client) return void (status.value = 'unavailable')
    if (auth?.status.value === 'signed-out' || auth?.status.value === 'unavailable') return void (status.value = 'signed-out')
    if (!auth?.userId.value) return void (status.value = 'idle')
    const mine = ++request
    if (status.value !== 'ready') status.value = 'loading'
    try {
      const [me, version, ms, mp, st] = await Promise.all([
        call<{ participating: boolean, opted_in_at: string | null }[]>('matchtips_me'),
        call<string>('matchtips_consent_version'),
        call<MatchRow[]>('matchtips_matches', { p_season: season }),
        call<MyPickRow[]>('matchtips_my_picks', { p_season: season }),
        call<StandingRow[]>('matchtips_leaderboard', { p_season: season }),
      ])
      if (mine !== request) return
      participating.value = !!me?.[0]?.participating
      optedInAt.value = me?.[0]?.opted_in_at ?? null
      consentVersion.value = version
      matches.value = (ms ?? []).map(toMatch)
      myPicks.value = Object.fromEntries((mp ?? []).map(toMyPick).map(p => [p.matchId, p]))
      standings.value = (st ?? []).map(toStanding)
      error.value = null
      status.value = 'ready'
    }
    catch (e) {
      if (mine !== request) return
      status.value = missingFunction(e) ? 'unavailable' : 'error'
      error.value = isNetwork(e) ? NETWORK : 'Matchtipset kunde inte hämtas. Försök igen.'
    }
  }

  /** Opt in, with the consent version that was shown. Only ever from the supporter's own click. */
  async function join(): Promise<boolean> {
    if (!client || joining.value || !consentVersion.value || participating.value) return false
    joining.value = true
    error.value = null
    try {
      await call('matchtips_join', { p_consent_version: consentVersion.value })
      await load()
      return true
    }
    catch (e) {
      const code = (e as DataError).code
      error.value = code === '42501' ? 'Välj ett läktarnamn först – det är det som syns i tabellen.' : code === '22023' ? 'Villkoren har ändrats. Läs dem igen innan du går med.' : isNetwork(e) ? NETWORK : 'Det gick inte att gå med. Försök igen.'
      if (code === '22023') void load()
      return false
    }
    finally {
      joining.value = false
    }
  }

  /** Leave (after the supporter confirmed): every tip, every version, is deleted. Returns how many. */
  async function leave(): Promise<number | null> {
    if (!client || leaving.value || !participating.value) return null
    leaving.value = true
    error.value = null
    try {
      const removed = await call<number>('matchtips_leave', { p_confirmed: true })
      picks.value = {}
      await load()
      return removed ?? 0
    }
    catch (e) {
      error.value = isNetwork(e) ? NETWORK : 'Det gick inte att lämna just nu. Försök igen.'
      return null
    }
    finally {
      leaving.value = false
    }
  }

  /** Save a tip. The database decides whether it's in time; a refusal reloads the match's real state. */
  async function submit(matchId: string, home: string | number, away: string | number): Promise<boolean> {
    if (!client || saving.value) return false
    const h = parseGoals(home)
    const a = parseGoals(away)
    if (h === null || a === null) {
      notes.value = { ...notes.value, [matchId]: { ok: false, text: `Fyll i hela mål, från 0 till ${MAX_GOALS}.` } }
      return false
    }
    saving.value = matchId
    try {
      const rows = await call<{ revision: number, submitted_at: string }[]>('matchtips_submit', { p_match: matchId, p_home: h, p_away: a })
      const at = rows?.[0]?.submitted_at ?? new Date().toISOString()
      myPicks.value = { ...myPicks.value, [matchId]: { matchId, pick: { home: h, away: a }, points: null, latest: { home: h, away: a, submittedAt: at }, latestCounts: true } }
      notes.value = { ...notes.value, [matchId]: { ok: true, text: `Sparat: ${h}–${a}. Du kan ändra fram till deadline.` } }
      return true
    }
    catch (e) {
      notes.value = { ...notes.value, [matchId]: { ok: false, text: submitErrorMessage(e) } }
      // Locked, paused or gone in the meantime: show the database's state.
      if (['55000', 'P0002', '42501'].includes((e as DataError).code ?? '')) void load()
      return false
    }
    finally {
      saving.value = null
    }
  }

  /** Everyone's picks for a match: the database returns them only once it has locked. */
  async function loadPicks(matchId: string) {
    if (!client) return
    picks.value = { ...picks.value, [matchId]: 'loading' }
    try {
      const rows = await call<PickRow[]>('matchtips_picks', { p_match: matchId })
      picks.value = { ...picks.value, [matchId]: (rows ?? []).map(r => ({ handle: r.handle, home: r.pick_home, away: r.pick_away, points: r.points })) }
    }
    catch {
      picks.value = { ...picks.value, [matchId]: 'error' }
    }
  }

  // Whoever is signed in owns what's shown: start again when that changes.
  if (auth) {
    watch([auth.userId, auth.status], () => {
      reset()
      void load()
    })
  }

  return { season, status, participating, optedInAt, consentVersion, matches, myPicks, standings, picks, joining, leaving, saving, notes, error, load, join, leave, submit, loadPicks }
}

export type MatchtipsStore = ReturnType<typeof createMatchtips>
