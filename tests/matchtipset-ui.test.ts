import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipMatch } from '../app/lib/matchtips'
import {
  createMatchtips, decidedLabel, lateNote, matchPhase, parseGoals, pointsLabel, submitErrorMessage, toMatch, toMyPick, toStanding,
} from '../app/lib/matchtips'

/*
 * Matchtipset's supporter UI logic (app/lib/matchtips), against a fake
 * Data API: what's shown for each state the database can be in, and that
 * the store only ever asks, never decides. The real functions are exercised
 * against a local Supabase stack in tests/matchtipset-stack.test.ts.
 */

const MATCH = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-11-12T12:00:00Z')

const row = (o: Record<string, unknown> = {}) => ({
  id: MATCH, season: '2026/27', home_team: 'Färjestad BK', away_team: 'Djurgården',
  scheduled_start: '2026-11-12T18:00:00+00:00', locks_at: '2026-11-12T18:00:00+00:00', locked: false,
  status: 'scheduled', void_reason: null,
  result_home_60: null, result_away_60: null, decided_in: null, result_revision: 0, result_source_url: null, result_note: null,
  deadline_corrected: false, deadline_correction_reason: null, deadline_correction_source_url: null,
  official_url: 'https://www.difhockey.se/game-schedule', ...o,
})
const m = (o: Record<string, unknown> = {}): TipMatch => toMatch(row(o) as never)

type Answer = { data?: unknown, error?: { code?: string, message?: string } }
function fakeClient(answers: Record<string, Answer | ((args: unknown) => Answer | Promise<Answer>)>) {
  const calls: { fn: string, args: unknown }[] = []
  const client = {
    rpc: async (fn: string, args?: unknown) => {
      calls.push({ fn, args })
      const a = answers[fn]
      const r = typeof a === 'function' ? await a(args) : a
      if (!r) throw new Error(`unexpected rpc ${fn}`)
      return { data: r.data ?? null, error: r.error ?? null }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}
const signedIn = (id: string | null = LOTTA) => ({ status: ref<'loading' | 'signed-in' | 'signed-out' | 'unavailable'>(id ? 'signed-in' : 'signed-out'), userId: ref<string | null>(id) })
const base = (o: Partial<Record<string, Answer | ((a: unknown) => Answer | Promise<Answer>)>> = {}) => ({
  matchtips_me: { data: [{ participating: false, opted_in_at: null, consent_version: null }] },
  matchtips_consent_version: { data: 'matchtipset-2026-11-09' },
  matchtips_matches: { data: [] },
  matchtips_my_picks: { data: [] },
  matchtips_leaderboard: { data: [] },
  ...o,
}) as Record<string, Answer | ((a: unknown) => Answer | Promise<Answer>)>

describe('match phases: the database decides, the clock only closes the form', () => {
  it('open, locked, settled, paused, postponed, void', () => {
    expect(matchPhase(m(), NOW)).toBe('open')
    expect(matchPhase(m({ locked: true }), NOW)).toBe('locked')
    // The database said open when read, but the deadline has since passed here.
    expect(matchPhase(m(), Date.parse('2026-11-12T18:00:01Z'))).toBe('locked')
    expect(matchPhase(m({ locked: true, result_home_60: 3, result_away_60: 3, decided_in: 'overtime', result_revision: 1 }), NOW)).toBe('settled')
    expect(matchPhase(m({ status: 'postponed', locks_at: null, locked: false }), NOW)).toBe('paused')
    expect(matchPhase(m({ status: 'postponed', locked: true }), NOW)).toBe('postponed')
    expect(matchPhase(m({ status: 'void', void_reason: 'Avbruten' }), NOW)).toBe('void')
    expect(matchPhase(m({ status: 'void', locks_at: null }), NOW)).toBe('void')
  })

  it('rows become the shapes the page shows; bigint counts arrive as numbers or strings', () => {
    const settled = m({ locked: true, result_home_60: 2, result_away_60: 1, decided_in: 'regulation', result_revision: 2, result_note: 'Rättad', deadline_corrected: true, deadline_correction_reason: 'Startade 18:00', deadline_correction_source_url: 'https://www.shl.se/x' })
    expect(settled.result).toEqual({ home: 2, away: 1, decidedIn: 'regulation', revision: 2, sourceUrl: null, note: 'Rättad' })
    expect(settled.deadlineCorrection).toEqual({ reason: 'Startade 18:00', sourceUrl: 'https://www.shl.se/x' })
    expect(m().result).toBeNull()
    expect(toStanding({ rank: '1', handle: 'lotta', points: '6', matches_tipped: '2', exact_scores: '2', correct_outcomes: '0' })).toEqual({ rank: 1, handle: 'lotta', points: 6, tipped: 2, exact: 2, outcomes: 0 })
  })
})

describe('words', () => {
  it('no result is never 0 points', () => {
    expect(pointsLabel(null)).toBe('Väntar på resultat')
    expect(pointsLabel(0)).toBe('0 poäng')
    expect(pointsLabel(1)).toBe('1 poäng – rätt utgång')
    expect(pointsLabel(3)).toBe('3 poäng – exakt rätt')
  })

  it('says how a game was decided, after the 60 minutes that count', () => {
    expect(decidedLabel('regulation')).toBe('Avgjord efter 60 minuter')
    expect(decidedLabel('overtime')).toMatch(/förlängning/)
    expect(decidedLabel('shootout')).toMatch(/straffar/)
  })

  it('a late tip after a corrected deadline: humane, with the deadline, and what still counts', () => {
    const match = m({ locks_at: '2026-11-12T17:00:00+00:00', locked: true, deadline_corrected: true })
    const kept = toMyPick({ match_id: MATCH, pick_home: 2, pick_away: 1, points: null, latest_home: 3, latest_away: 1, latest_submitted_at: '2026-11-12T17:20:00+00:00', latest_counts: false })
    expect(lateNote(kept, match)).toBe('Räknas inte – matchens starttid har rättats. Ditt tips 3–1 kom efter den rättade deadlinen (18:00), fast tippningen var öppen när du lämnade det. Ditt tidigare tips 2–1 gäller.')
    const none = toMyPick({ match_id: MATCH, pick_home: null, pick_away: null, points: null, latest_home: 1, latest_away: 1, latest_submitted_at: '2026-11-12T17:20:00+00:00', latest_counts: false })
    expect(lateNote(none, match)).toMatch(/inget tidigare tips som räknas/)
    expect(lateNote({ ...kept, latestCounts: true }, match)).toBeNull()
  })

  it('goals: whole numbers 0–30 only', () => {
    expect(['0', '3', ' 12 ', '30', 7].map(parseGoals)).toEqual([0, 3, 12, 30, 7])
    expect(['', '-1', '31', '2.5', 'tre', '007'].map(parseGoals)).toEqual([null, null, null, null, null, null])
  })

  it("the database's refusals, in Swedish", () => {
    expect(submitErrorMessage({ code: '55000' })).toMatch(/stängd/)
    expect(submitErrorMessage({ code: '42501' })).toMatch(/vara med/)
    expect(submitErrorMessage({ code: '22023' })).toMatch(/0 till 30/)
    expect(submitErrorMessage({ code: '54000' })).toMatch(/för många gånger/)
    expect(submitErrorMessage(new TypeError('Failed to fetch'))).toMatch(/uppkopplingen/)
  })
})

describe('the store', () => {
  it('a guest triggers no request at all', async () => {
    const { client, calls } = fakeClient(base())
    const tips = createMatchtips(client, signedIn(null))
    await tips.load()
    expect(tips.status.value).toBe('signed-out')
    expect(calls).toEqual([])
  })

  it('signed in: loads the real state; no matches means an honest empty list; visiting never joins', async () => {
    const { client, calls } = fakeClient(base())
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(tips.status.value).toBe('ready')
    expect(tips.participating.value).toBe(false)
    expect(tips.consentVersion.value).toBe('matchtipset-2026-11-09')
    expect(tips.matches.value).toEqual([])
    expect(calls.map(c => c.fn).sort()).toEqual(['matchtips_consent_version', 'matchtips_leaderboard', 'matchtips_matches', 'matchtips_me', 'matchtips_my_picks'])
    expect(calls.find(c => c.fn === 'matchtips_matches')!.args).toEqual({ p_season: '2026/27' })
  })

  it('joins only when asked, with the consent version the database gave', async () => {
    let joined = false
    const { client, calls } = fakeClient(base({
      matchtips_me: () => ({ data: [{ participating: joined, opted_in_at: joined ? '2026-11-09T17:00:00+00:00' : null }] }),
      matchtips_join: (args) => { joined = true; expect(args).toEqual({ p_consent_version: 'matchtipset-2026-11-09' }); return { data: '2026-11-09T17:00:00+00:00' } },
    }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(calls.some(c => c.fn === 'matchtips_join')).toBe(false)
    expect(await tips.join()).toBe(true)
    expect(tips.participating.value).toBe(true)
    expect(tips.optedInAt.value).toBe('2026-11-09T17:00:00+00:00')
  })

  it('joining without a profile: the database refuses, and the page says what to do', async () => {
    const { client } = fakeClient(base({ matchtips_join: { error: { code: '42501', message: 'only a signed-in supporter with a profile can join Matchtipset' } } }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(await tips.join()).toBe(false)
    expect(tips.error.value).toMatch(/läktarnamn/)
  })

  it('submit: saved as the database recorded it; never decides validity itself', async () => {
    const { client, calls } = fakeClient(base({
      matchtips_me: { data: [{ participating: true, opted_in_at: '2026-11-09T17:00:00+00:00' }] },
      matchtips_matches: { data: [row()] },
      matchtips_submit: { data: [{ revision: 1, submitted_at: '2026-11-12T12:00:00+00:00', locks_at: '2026-11-12T18:00:00+00:00' }] },
    }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(await tips.submit(MATCH, '2', ' 1')).toBe(true)
    expect(calls.at(-1)).toEqual({ fn: 'matchtips_submit', args: { p_match: MATCH, p_home: 2, p_away: 1 } })
    expect(tips.myPicks.value[MATCH]).toMatchObject({ pick: { home: 2, away: 1 }, points: null, latestCounts: true })
    expect(tips.notes.value[MATCH]).toEqual({ ok: true, text: 'Sparat: 2–1. Du kan ändra fram till deadline.' })
    // Nonsense never reaches the database.
    const before = calls.length
    expect(await tips.submit(MATCH, '31', '0')).toBe(false)
    expect(calls.length).toBe(before)
  })

  it('a server-denied submit (locked in the meantime) says so and reloads the real state', async () => {
    let locked = false
    const { client, calls } = fakeClient(base({
      matchtips_me: { data: [{ participating: true, opted_in_at: null }] },
      matchtips_matches: () => ({ data: [row({ locked })] }),
      matchtips_submit: () => { locked = true; return { error: { code: '55000', message: 'predictions for this match are locked' } } },
    }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(matchPhase(tips.matches.value[0]!, NOW)).toBe('open')
    expect(await tips.submit(MATCH, 1, 1)).toBe(false)
    expect(tips.notes.value[MATCH]).toEqual({ ok: false, text: 'Tippningen för matchen är stängd. Deadlinen är den som gäller här nedan.' })
    await new Promise(r => setTimeout(r))
    expect(calls.filter(c => c.fn === 'matchtips_matches')).toHaveLength(2)
    expect(matchPhase(tips.matches.value[0]!, NOW)).toBe('locked')
    expect(tips.myPicks.value[MATCH]).toBeUndefined()
  })

  it('paused and corrected matches come through as the database states them', async () => {
    const { client } = fakeClient(base({
      matchtips_matches: { data: [row({ status: 'postponed', locks_at: null }), row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', locked: true, deadline_corrected: true, deadline_correction_reason: 'Startade 18:00', deadline_correction_source_url: 'https://www.shl.se/x' })] },
      matchtips_my_picks: { data: [{ match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pick_home: 2, pick_away: 1, points: null, latest_home: 3, latest_away: 1, latest_submitted_at: '2026-11-12T17:20:00+00:00', latest_counts: false }] },
    }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    const [paused, corrected] = tips.matches.value
    expect(matchPhase(paused!, NOW)).toBe('paused')
    expect(corrected!.deadlineCorrection).toEqual({ reason: 'Startade 18:00', sourceUrl: 'https://www.shl.se/x' })
    expect(tips.myPicks.value['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']).toMatchObject({ pick: { home: 2, away: 1 }, latestCounts: false })
  })

  it("everyone's picks: fetched on request; pending points stay pending", async () => {
    const { client } = fakeClient(base({ matchtips_picks: { data: [{ handle: 'jarnmannen', pick_home: 3, pick_away: 3, points: null }, { handle: 'lotta', pick_home: 2, pick_away: 1, points: null }] } }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(tips.picks.value[MATCH]).toBeUndefined()
    await tips.loadPicks(MATCH)
    expect(tips.picks.value[MATCH]).toEqual([{ handle: 'jarnmannen', home: 3, away: 3, points: null }, { handle: 'lotta', home: 2, away: 1, points: null }])
  })

  it('the leaderboard is the database’s: ties keep their shared rank', async () => {
    const { client } = fakeClient(base({ matchtips_leaderboard: { data: [
      { rank: 1, handle: 'jarnmannen', points: 4, matches_tipped: 2, exact_scores: 1, correct_outcomes: 1 },
      { rank: 1, handle: 'mattias', points: 4, matches_tipped: 2, exact_scores: 1, correct_outcomes: 1 },
      { rank: 3, handle: 'lotta', points: 0, matches_tipped: 0, exact_scores: 0, correct_outcomes: 0 },
    ] } }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(tips.standings.value.map(s => [s.rank, s.handle, s.points])).toEqual([[1, 'jarnmannen', 4], [1, 'mattias', 4], [3, 'lotta', 0]])
  })

  it('leaving is confirmed (p_confirmed) and reports how many tips were deleted', async () => {
    let member = true
    const { client, calls } = fakeClient(base({
      matchtips_me: () => ({ data: [{ participating: member, opted_in_at: null }] }),
      matchtips_leave: (args) => { expect(args).toEqual({ p_confirmed: true }); member = false; return { data: 3 } },
    }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(await tips.leave()).toBe(3)
    expect(tips.participating.value).toBe(false)
    expect(calls.filter(c => c.fn === 'matchtips_leave')).toHaveLength(1)
  })

  it('a database without the functions: unavailable, not an error to retry', async () => {
    const { client } = fakeClient(base({ matchtips_me: { error: { code: 'PGRST202', message: 'Could not find the function' } } }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    expect(tips.status.value).toBe('unavailable')
  })

  it("someone else signs in: the previous supporter's state is gone before the new load", async () => {
    const { client } = fakeClient(base({ matchtips_me: { data: [{ participating: true, opted_in_at: null }] }, matchtips_my_picks: { data: [{ match_id: MATCH, pick_home: 1, pick_away: 0, points: null, latest_home: 1, latest_away: 0, latest_submitted_at: '2026-11-12T10:00:00+00:00', latest_counts: true }] } }))
    const auth = signedIn()
    const tips = createMatchtips(client, auth)
    await tips.load()
    expect(Object.keys(tips.myPicks.value)).toEqual([MATCH])
    auth.status.value = 'signed-out'
    auth.userId.value = null
    await nextTick()
    expect(tips.myPicks.value).toEqual({})
    expect(tips.participating.value).toBe(false)
    expect(tips.status.value).toBe('signed-out')
  })
})

/*
 * Signing out, or another supporter signing in, while a request is still on
 * its way: it may finish at the server, but its answer never lands on the
 * next supporter's page.
 */
describe('account switches with requests in flight', () => {
  const BO = '22222222-2222-4222-8222-222222222222'
  const LOCKED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  /** A promise the test settles by hand. */
  function deferred() {
    let resolve!: (a: Answer) => void
    const promise = new Promise<Answer>(r => (resolve = r))
    return { promise, resolve }
  }
  const settle = () => new Promise(r => setTimeout(r))
  /** Lotta takes part and has a pick; Bo doesn't take part and has none. `pending` answers are settled by the test. */
  function world(pending: Record<string, () => Promise<Answer>> = {}) {
    const auth = signedIn(LOTTA)
    const lotta = () => auth.userId.value === LOTTA
    const { client, calls } = fakeClient(base({
      matchtips_me: () => ({ data: [{ participating: lotta(), opted_in_at: lotta() ? '2026-11-09T17:00:00+00:00' : null }] }),
      matchtips_matches: { data: [row(), row({ id: LOCKED, locked: true })] },
      matchtips_my_picks: () => ({ data: lotta() ? [{ match_id: MATCH, pick_home: 1, pick_away: 0, points: null, latest_home: 1, latest_away: 0, latest_submitted_at: '2026-11-12T10:00:00+00:00', latest_counts: true }] : [] }),
      ...pending,
    }))
    return { auth, client, calls }
  }
  const signOut = (auth: ReturnType<typeof signedIn>) => {
    auth.status.value = 'signed-out'
    auth.userId.value = null
  }
  const signInAsBo = (auth: ReturnType<typeof signedIn>) => (auth.userId.value = BO)

  it("Lotta's pending tip resolves after she signs out: nothing of hers comes back", async () => {
    const submit = deferred()
    const { auth, client } = world({ matchtips_submit: () => submit.promise })
    const tips = createMatchtips(client, auth)
    await tips.load()
    const saving = tips.submit(MATCH, 4, 2)
    expect(tips.saving.value).toBe(MATCH)
    signOut(auth)
    await settle()
    submit.resolve({ data: [{ revision: 2, submitted_at: '2026-11-12T12:00:00+00:00' }] })
    expect(await saving).toBe(false)
    expect(tips.myPicks.value).toEqual({})
    expect(tips.notes.value).toEqual({})
    expect(tips.saving.value).toBeNull()
    expect(tips.participating.value).toBe(false)
    expect(tips.status.value).toBe('signed-out')
  })

  it("Lotta's pending tip resolves after Bo has signed in and loaded: Bo's page shows none of it", async () => {
    const submit = deferred()
    const { auth, client } = world({ matchtips_submit: () => submit.promise })
    const tips = createMatchtips(client, auth)
    await tips.load()
    const saving = tips.submit(MATCH, 4, 2)
    signInAsBo(auth)
    await settle()
    expect(tips.status.value).toBe('ready')
    expect(tips.participating.value).toBe(false)
    expect(tips.myPicks.value).toEqual({})
    submit.resolve({ data: [{ revision: 2, submitted_at: '2026-11-12T12:00:00+00:00' }] })
    await saving
    expect(tips.myPicks.value).toEqual({})
    expect(tips.notes.value).toEqual({})
    expect(tips.saving.value).toBeNull()
  })

  it("a refusal of Lotta's tip after the switch: no note on Bo's page, no reload on Lotta's behalf", async () => {
    const submit = deferred()
    const { auth, client, calls } = world({ matchtips_submit: () => submit.promise })
    const tips = createMatchtips(client, auth)
    await tips.load()
    const saving = tips.submit(MATCH, 4, 2)
    signInAsBo(auth)
    await settle()
    const loads = calls.filter(c => c.fn === 'matchtips_matches').length
    submit.resolve({ error: { code: '55000', message: 'predictions for this match are locked' } })
    await saving
    await settle()
    expect(tips.notes.value).toEqual({})
    expect(calls.filter(c => c.fn === 'matchtips_matches').length).toBe(loads)
  })

  it("Bo can tip while Lotta's old request is still pending, and its end doesn't clear Bo's saving state", async () => {
    const lotta = deferred()
    const bo = deferred()
    const queue = [lotta, bo]
    const { auth, client } = world({ matchtips_submit: () => queue.shift()!.promise })
    const tips = createMatchtips(client, auth)
    await tips.load()
    const first = tips.submit(MATCH, 4, 2)
    signInAsBo(auth)
    await settle()
    const second = tips.submit(MATCH, 0, 0)
    expect(tips.saving.value).toBe(MATCH)
    lotta.resolve({ data: [{ revision: 2, submitted_at: '2026-11-12T12:00:00+00:00' }] })
    await first
    expect(tips.saving.value).toBe(MATCH)
    bo.resolve({ data: [{ revision: 1, submitted_at: '2026-11-12T12:01:00+00:00' }] })
    expect(await second).toBe(true)
    expect(tips.myPicks.value[MATCH]).toMatchObject({ pick: { home: 0, away: 0 } })
    expect(tips.saving.value).toBeNull()
  })

  it('joining that finishes after the switch never marks Bo as taking part', async () => {
    const join = deferred()
    const auth = signedIn(LOTTA)
    let lottaJoined = false
    const { client } = fakeClient(base({
      matchtips_me: () => ({ data: [{ participating: auth.userId.value === LOTTA && lottaJoined, opted_in_at: null }] }),
      matchtips_join: async () => {
        const r = await join.promise
        lottaJoined = true
        return r
      },
    }))
    const tips = createMatchtips(client, auth)
    await tips.load()
    const joining = tips.join()
    expect(tips.joining.value).toBe(true)
    signInAsBo(auth)
    await settle()
    expect(tips.joining.value).toBe(false)
    join.resolve({ data: '2026-11-09T17:00:00+00:00' })
    expect(await joining).toBe(false)
    await settle()
    expect(tips.participating.value).toBe(false)
    expect(tips.error.value).toBeNull()
  })

  it("leaving that finishes after the switch doesn't touch Bo's state", async () => {
    const leave = deferred()
    const { auth, client } = world({ matchtips_leave: () => leave.promise })
    const tips = createMatchtips(client, auth)
    await tips.load()
    expect(tips.participating.value).toBe(true)
    const leaving = tips.leave()
    signInAsBo(auth)
    await settle()
    leave.resolve({ error: { message: 'Failed to fetch' } })
    expect(await leaving).toBeNull()
    expect(tips.error.value).toBeNull()
    expect(tips.leaving.value).toBe(false)
  })

  it("everyone's picks fetched while Lotta was signed in never show after she signs out", async () => {
    const picks = deferred()
    const { auth, client } = world({ matchtips_picks: () => picks.promise })
    const tips = createMatchtips(client, auth)
    await tips.load()
    const loading = tips.loadPicks(LOCKED)
    signOut(auth)
    await settle()
    picks.resolve({ data: [{ handle: 'lotta', pick_home: 1, pick_away: 0, points: null }] })
    await loading
    expect(tips.picks.value).toEqual({})
  })

  it('a reload forgets fetched pick lists, so a corrected result never shows old points', async () => {
    let points: number | null = 3
    const { client } = fakeClient(base({ matchtips_picks: () => ({ data: [{ handle: 'lotta', pick_home: 2, pick_away: 1, points }] }) }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    await tips.loadPicks(MATCH)
    expect(tips.picks.value[MATCH]).toEqual([{ handle: 'lotta', home: 2, away: 1, points: 3 }])
    points = 0
    await tips.load()
    expect(tips.picks.value).toEqual({})
    await tips.loadPicks(MATCH)
    expect(tips.picks.value[MATCH]).toEqual([{ handle: 'lotta', home: 2, away: 1, points: 0 }])
  })

  it('a pick list requested before a reload is dropped when it arrives after it', async () => {
    const picks = deferred()
    const { client } = fakeClient(base({ matchtips_picks: () => picks.promise }))
    const tips = createMatchtips(client, signedIn())
    await tips.load()
    const loading = tips.loadPicks(MATCH)
    await tips.load()
    picks.resolve({ data: [{ handle: 'lotta', pick_home: 2, pick_away: 1, points: 3 }] })
    await loading
    expect(tips.picks.value).toEqual({})
  })
})
