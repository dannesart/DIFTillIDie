import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { as, codeOf, createSupabaseLikeDb, realDataSnapshot, seedRealData } from './db/supabase-harness'

/*
 * Matchtipset's database rules (supabase/migrations/…_matchtipset_foundation),
 * run against the real migrations in PGlite (see supabase-harness).
 * Järnmannen and Mattias take part, Lotta has a profile but hasn't joined,
 * Nils is signed in without a profile. Owner operations run as the harness
 * owner (postgres), as they do from the SQL editor.
 *
 * Matches whose deadline has passed are fixtures inserted directly (with the
 * ops guard switched on for that one transaction), since a real match can only
 * be entered before it starts. Concurrency needs real connections: that's
 * tests/matchtipset-stack.test.ts, against a local Supabase stack in CI.
 *
 * Codes: 42501 permission denied, 22023 invalid parameter, 23514 check,
 * 55000 locked / wrong state, 54000 limit, P0002 no such match, 42883 no such function.
 */

const JARN = '44444444-4444-4444-8444-444444444444'
const MATTIAS = '55555555-5555-4555-8555-555555555555'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const NILS = '33333333-3333-4333-8333-333333333333'
const SEASON = '2026/27'
const SRC = 'https://www.shl.se/game/test-report'
const CONSENT = 'matchtipset-2026-11-09'

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${JARN}', 'j@example.test'), ('${MATTIAS}', 'm@example.test'), ('${LOTTA}', 'l@example.test'), ('${NILS}', 'n@example.test')`)
  for (const [id, name, handle] of [[JARN, 'Järnmannen', 'jarnmannen'], [MATTIAS, 'Mattias', 'mattias'], [LOTTA, 'Lotta', 'lotta_g']] as const) {
    await as(db, 'authenticated', id, () => db.query('insert into public.profiles (id, display_name, handle) values ($1, $2, $3)', [id, name, handle]))
  }
  for (const id of [JARN, MATTIAS]) await as(db, 'authenticated', id, () => db.query('select public.matchtips_join($1)', [CONSENT]))
})

// ── helpers ────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>
const rows = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T = Row>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0]!
const user = <T>(id: string | null, fn: () => Promise<T>) => as(db, 'authenticated', id, fn)

/** A real match, entered as the owner would: start `min` minutes from now. */
async function createMatch(min = 60, home = 'Djurgården', away = 'Färjestad BK') {
  return (await one<{ id: string }>(
    `select matchtips_ops.create_match($1, $2, $3, now() + $4::numeric * interval '1 minute', $5, null, 'Verifierad mot difhockey.se', 'daniel') as id`,
    [SEASON, home, away, min, SRC])).id
}

/** A fixture match at any point in time (e.g. already locked), inserted past the ops functions. */
async function fixtureMatch(o: { startMin: number, locksMin?: number, season?: string, home?: string, away?: string }) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('matchtips.via_ops', 'on', true)`)
    const r = await tx.query<{ id: string }>(
      `insert into matchtips.matches (season, home_team, away_team, scheduled_start, locks_at, official_url)
       values ($1, $2, $3, now() + $4::numeric * interval '1 minute', now() + $5::numeric * interval '1 minute', $6) returning id`,
      [o.season ?? SEASON, o.home ?? 'Djurgården', o.away ?? 'Växjö Lakers', o.startMin, o.locksMin ?? o.startMin, SRC])
    return r.rows[0]!.id
  })
}

/** A submission made `agoMin` minutes ago (fixture; the RPC always uses the current time). */
const fixtureSubmission = (match: string, profile: string, revision: number, home: number, away: number, agoMin: number) =>
  db.query(`insert into matchtips.prediction_submissions (match_id, profile_id, revision, home_goals, away_goals, submitted_at)
            values ($1, $2, $3, $4, $5, now() - $6::numeric * interval '1 minute')`, [match, profile, revision, home, away, agoMin])

const submit = (id: string, match: string, home: number, away: number) =>
  user(id, () => one<{ revision: number }>('select * from public.matchtips_submit($1, $2, $3)', [match, home, away]))
const picks = (id: string | null, match: string) =>
  user(id, () => rows<{ handle: string, pick_home: number, pick_away: number, points: number | null }>('select * from public.matchtips_picks($1)', [match]))
const myPicks = (id: string) =>
  user(id, () => rows<Row>('select * from public.matchtips_my_picks($1)', [SEASON]))
const board = async (id: string) =>
  (await user(id, () => rows<Row>('select * from public.matchtips_leaderboard($1)', [SEASON])))
    .map(r => ({ rank: Number(r.rank), handle: r.handle, points: Number(r.points), tipped: Number(r.matches_tipped), exact: Number(r.exact_scores), outcomes: Number(r.correct_outcomes) }))
const result = (match: string, h: number, a: number, decided: string, reason = 'Matchrapport shl.se, efter 60 min') =>
  db.query('select matchtips_ops.record_result($1, $2, $3, $4, $5, $6, $7)', [match, h, a, decided, SRC, reason, 'daniel'])
const log = (match: string) =>
  rows<Row>('select action, old_values, new_values, source_url, reason, operator_declared, db_role from matchtips.match_log where match_id = $1 order by id', [match])

// ── 1. The boundary: no API role reaches the data ──────────────────────────
describe('grants and exposure', () => {
  it('no API role can use the matchtips schemas or touch their tables', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const schema of ['matchtips', 'matchtips_ops']) {
        expect((await one<{ ok: boolean }>(`select has_schema_privilege($1, $2, 'usage') as ok`, [role, schema])).ok).toBe(false)
      }
      for (const table of ['matches', 'match_log', 'participants', 'prediction_submissions']) {
        expect((await one<{ ok: boolean }>(`select has_table_privilege($1, $2, 'select,insert,update,delete') as ok`, [role, `matchtips.${table}`])).ok).toBe(false)
      }
    }
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query('select * from matchtips.prediction_submissions'))).toBe('42501')
      expect(await codeOf(db.query('select * from matchtips.matches'))).toBe('42501')
    })
    await user(JARN, async () => {
      expect(await codeOf(db.query('select * from matchtips.prediction_submissions'))).toBe('42501')
      expect(await codeOf(db.query('select * from matchtips.participants'))).toBe('42501')
      expect(await codeOf(db.query(`insert into matchtips.participants (profile_id, consent_version) values ($1, 'x')`, [LOTTA]))).toBe('42501')
    })
  })

  it('RLS is on everywhere, with no policies (the functions are the only way in)', async () => {
    const t = await rows<{ relname: string, relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'matchtips'::regnamespace and relkind = 'r' order by relname`)
    expect(t).toEqual(['match_log', 'matches', 'participants', 'prediction_submissions'].map(relname => ({ relname, relrowsecurity: true })))
    expect((await one<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'matchtips'`)).n).toBe(0)
  })

  it('exactly the supporter functions are callable, by signed-in roles only; ops by nobody but the owner', async () => {
    const fns = await rows<{ sig: string, anon: boolean, authed: boolean, service: boolean, definer: boolean, path: string[] | null }>(`
      select p.oid::regprocedure::text as sig,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as authed,
        has_function_privilege('service_role', p.oid, 'execute') as service,
        p.prosecdef as definer, p.proconfig as path
      from pg_proc p
      where p.pronamespace in ('matchtips'::regnamespace, 'matchtips_ops'::regnamespace) or p.proname like 'matchtips\\_%'
      order by 1`)
    const supporter = fns.filter(f => f.sig.startsWith('matchtips_') && !f.sig.includes('.'))
    expect(supporter.map(f => f.sig)).toEqual([
      'matchtips_consent_version()', 'matchtips_join(text)', 'matchtips_leaderboard(text)', 'matchtips_leave(boolean)',
      'matchtips_matches(text)', 'matchtips_me()', 'matchtips_my_picks(text)', 'matchtips_picks(uuid)', 'matchtips_submit(uuid,integer,integer)',
    ])
    for (const f of supporter) expect({ sig: f.sig, anon: f.anon, authed: f.authed, path: f.path }).toEqual({ sig: f.sig, anon: false, authed: true, path: ['search_path=""'] })
    for (const f of fns.filter(f => !supporter.includes(f))) {
      expect({ sig: f.sig, anon: f.anon, authed: f.authed, service: f.service }).toEqual({ sig: f.sig, anon: false, authed: false, service: false })
    }
    // Only the supporter functions run with the owner's rights.
    expect(fns.filter(f => f.definer).map(f => f.sig)).toEqual(supporter.filter(f => f.sig !== 'matchtips_consent_version()').map(f => f.sig))
  })

  it('anonymous visitors get nothing: every supporter function is refused', async () => {
    const m = await createMatch()
    await as(db, 'anon', null, async () => {
      for (const q of [
        ['select public.matchtips_join($1)', [CONSENT]], ['select public.matchtips_submit($1, 1, 0)', [m]],
        ['select * from public.matchtips_picks($1)', [m]], ['select * from public.matchtips_leaderboard($1)', [SEASON]],
        ['select * from public.matchtips_matches($1)', [SEASON]], ['select * from public.matchtips_my_picks($1)', [SEASON]],
        ['select * from public.matchtips_me()', []], ['select public.matchtips_leave(true)', []],
      ] as const) expect(await codeOf(db.query(q[0], [...q[1]]))).toBe('42501')
    })
  })

  it('a signed-in role without a user id is refused too', async () => {
    await as(db, 'authenticated', null, async () => {
      expect(await codeOf(db.query('select * from public.matchtips_leaderboard($1)', [SEASON]))).toBe('42501')
      expect(await codeOf(db.query('select * from public.matchtips_me()'))).toBe('42501')
    })
  })
})

// ── 2. Opt-in and opt-out ───────────────────────────────────────────────────
describe('participation', () => {
  it('joining needs a profile and the current consent version; joining twice changes nothing', async () => {
    expect(await user(NILS, () => codeOf(db.query('select public.matchtips_join($1)', [CONSENT])))).toBe('42501')
    expect(await user(LOTTA, () => codeOf(db.query('select public.matchtips_join($1)', ['old-version'])))).toBe('22023')
    expect(await user(LOTTA, () => codeOf(db.query('select public.matchtips_join(null)')))).toBe('22023')
    expect(await user(LOTTA, () => one('select * from public.matchtips_me()'))).toMatchObject({ participating: false })
    const first = await user(LOTTA, () => one<{ t: Date }>('select public.matchtips_join($1) as t', [CONSENT]))
    const again = await user(LOTTA, () => one<{ t: Date }>('select public.matchtips_join($1) as t', [CONSENT]))
    expect(again.t).toEqual(first.t)
    expect(await user(LOTTA, () => one('select * from public.matchtips_me()'))).toMatchObject({ participating: true, consent_version: CONSENT })
  })

  it('predicting needs participation', async () => {
    const m = await createMatch()
    expect(await user(LOTTA, () => codeOf(db.query('select public.matchtips_submit($1, 2, 1)', [m])))).toBe('42501')
    expect(await user(NILS, () => codeOf(db.query('select public.matchtips_submit($1, 2, 1)', [m])))).toBe('42501')
  })

  it('leaving must be confirmed, deletes every revision of every prediction, keeps the account, and rejoining starts fresh', async () => {
    const m1 = await createMatch(60)
    const m2 = await createMatch(120, 'Luleå HF', 'Djurgården')
    await submit(JARN, m1, 1, 0)
    await submit(JARN, m1, 2, 0)
    await submit(JARN, m2, 3, 3)
    await submit(MATTIAS, m1, 4, 1)
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_leave(false)')))).toBe('22023')
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_leave(null)')))).toBe('22023')
    expect((await user(JARN, () => one<{ n: number }>('select public.matchtips_leave(true) as n'))).n).toBe(3)

    expect(await rows('select profile_id::text as p, revision from matchtips.prediction_submissions order by 1, 2')).toEqual([{ p: MATTIAS, revision: 1 }])
    expect(await rows('select profile_id::text as p from matchtips.participants')).toEqual([{ p: MATTIAS }])
    expect(await rows('select handle from public.profiles where id = $1', [JARN])).toEqual([{ handle: 'jarnmannen' }])
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 1, 1)', [m1])))).toBe('42501')

    await user(JARN, () => db.query('select public.matchtips_join($1)', [CONSENT]))
    expect(await myPicks(JARN)).toEqual([])
    expect((await submit(JARN, m1, 5, 5)).revision).toBe(1)
  })
})

// ── 3. Append-only submissions ──────────────────────────────────────────────
describe('submissions', () => {
  it('every change is a new revision; the latest before the deadline is the pick', async () => {
    const m = await createMatch()
    expect((await submit(JARN, m, 2, 1)).revision).toBe(1)
    expect((await submit(JARN, m, 3, 1)).revision).toBe(2)
    expect((await submit(JARN, m, 3, 3)).revision).toBe(3)
    expect((await submit(MATTIAS, m, 0, 2)).revision).toBe(1)
    expect(await rows('select revision, home_goals, away_goals from matchtips.prediction_submissions where profile_id = $1 order by revision', [JARN]))
      .toEqual([{ revision: 1, home_goals: 2, away_goals: 1 }, { revision: 2, home_goals: 3, away_goals: 1 }, { revision: 3, home_goals: 3, away_goals: 3 }])
    expect(await myPicks(JARN)).toEqual([expect.objectContaining({ match_id: m, pick_home: 3, pick_away: 3, points: null, latest_home: 3, latest_away: 3, latest_counts: true })])
  })

  it('author, time, revision and points cannot come from the client', async () => {
    const m = await createMatch()
    await user(JARN, async () => {
      expect(await codeOf(db.query('select public.matchtips_submit($1, 2, 1, $2)', [m, MATTIAS]))).toBe('42883')
      expect(await codeOf(db.query(`insert into matchtips.prediction_submissions (match_id, profile_id, revision, home_goals, away_goals, submitted_at) values ($1, $2, 1, 9, 0, now())`, [m, MATTIAS]))).toBe('42501')
      expect(await codeOf(db.query(`update matchtips.prediction_submissions set home_goals = 9`))).toBe('42501')
      expect(await codeOf(db.query(`update matchtips.matches set result_home_60 = 9`))).toBe('42501')
    })
    expect((await one<{ n: number }>('select count(*)::int as n from matchtips.prediction_submissions')).n).toBe(0)
  })

  it('refuses nonsense goals, unknown matches, locked and void matches', async () => {
    const open = await createMatch()
    const locked = await fixtureMatch({ startMin: -1 })
    await user(JARN, async () => {
      expect(await codeOf(db.query('select public.matchtips_submit($1, -1, 0)', [open]))).toBe('22023')
      expect(await codeOf(db.query('select public.matchtips_submit($1, 31, 0)', [open]))).toBe('22023')
      expect(await codeOf(db.query('select public.matchtips_submit($1, null, 0)', [open]))).toBe('22023')
      expect(await codeOf(db.query('select public.matchtips_submit($1, 1, 0)', ['00000000-0000-4000-8000-000000000000']))).toBe('P0002')
      expect(await codeOf(db.query('select public.matchtips_submit($1, 1, 0)', [locked]))).toBe('55000')
    })
    await db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [open, SRC, 'Matchen ställdes in', 'daniel'])
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 1, 0)', [open])))).toBe('55000')
  })

  it('caps how many times one prediction can change', async () => {
    const m = await createMatch()
    for (let i = 0; i < 50; i++) await submit(JARN, m, i % 10, 1)
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 1, 1)', [m])))).toBe('54000')
  })

  it('submissions are append-only even for the owner, and cannot be dated ahead or past the deadline', async () => {
    const m = await createMatch()
    await submit(JARN, m, 2, 1)
    expect(await codeOf(db.query('update matchtips.prediction_submissions set home_goals = 5'))).toBe('42501')
    expect(await codeOf(db.query(`insert into matchtips.prediction_submissions (match_id, profile_id, revision, home_goals, away_goals, submitted_at) values ($1, $2, 9, 1, 1, now() + interval '1 minute')`, [m, JARN]))).toBe('55000')
    const locked = await fixtureMatch({ startMin: -10 })
    expect(await codeOf(fixtureSubmission(locked, JARN, 1, 1, 1, 5))).toBe('55000')
  })
})

// ── 4. Secrecy before the deadline ──────────────────────────────────────────
describe('visibility', () => {
  it('before the deadline nobody else sees a pick, a count or a point', async () => {
    const m = await createMatch()
    await submit(JARN, m, 2, 1)
    await submit(JARN, m, 4, 1)
    for (const viewer of [MATTIAS, LOTTA, NILS, JARN]) expect(await picks(viewer, m)).toEqual([])
    expect(await myPicks(MATTIAS)).toEqual([])
    expect(await board(MATTIAS)).toEqual([
      { rank: 1, handle: 'jarnmannen', points: 0, tipped: 0, exact: 0, outcomes: 0 },
      { rank: 1, handle: 'mattias', points: 0, tipped: 0, exact: 0, outcomes: 0 },
    ])
  })

  it('after the deadline signed-in supporters see effective picks only, never revisions; non-participants never appear', async () => {
    const m = await fixtureMatch({ startMin: -5 })
    await fixtureSubmission(m, JARN, 1, 1, 0, 60)
    await fixtureSubmission(m, JARN, 2, 2, 2, 30)
    await fixtureSubmission(m, MATTIAS, 1, 0, 3, 20)
    const expected = [{ handle: 'jarnmannen', pick_home: 2, pick_away: 2, points: null }, { handle: 'mattias', pick_home: 0, pick_away: 3, points: null }]
    expect(await picks(LOTTA, m)).toEqual(expected)
    expect(await picks(NILS, m)).toEqual(expected)
    expect(await myPicks(MATTIAS)).toEqual([expect.objectContaining({ match_id: m, pick_home: 0, pick_away: 3 })])
    expect((await board(LOTTA)).map(r => r.handle)).toEqual(['jarnmannen', 'mattias'])
  })

  it('handles come out only through the functions: profiles RLS still hides supporters who never posted', async () => {
    const m = await fixtureMatch({ startMin: -5 })
    await fixtureSubmission(m, JARN, 1, 1, 0, 20)
    expect(await as(db, 'anon', null, () => rows('select handle from public.profiles'))).toEqual([])
    expect(await user(MATTIAS, () => rows('select handle from public.profiles'))).toEqual([{ handle: 'mattias' }])
  })
})

// ── 5. The corrected deadline ───────────────────────────────────────────────
describe('deadline corrections', () => {
  it('17:30 → 2–1, 18:20 → 3–1, published 19:00, really 18:00: the 2–1 counts again, only Järnmannen sees his 3–1 didn’t', async () => {
    // Now is "after 19:00". The published deadline (19:00) was 60 min ago.
    const m = await fixtureMatch({ startMin: -60 })
    await fixtureSubmission(m, JARN, 1, 2, 1, 150) // 17:30
    await fixtureSubmission(m, JARN, 2, 3, 1, 100) // 18:20
    await fixtureSubmission(m, MATTIAS, 1, 1, 1, 100) // 18:20, his only pick
    expect(await picks(LOTTA, m)).toEqual([
      { handle: 'jarnmannen', pick_home: 3, pick_away: 1, points: null },
      { handle: 'mattias', pick_home: 1, pick_away: 1, points: null },
    ])

    await db.query(`select matchtips_ops.correct_deadline($1, now() - interval '120 minutes', $2, 'Matchen startade 18:00 enligt shl.se, inte 19:00', 'daniel')`, [m, SRC])

    expect(await picks(LOTTA, m)).toEqual([{ handle: 'jarnmannen', pick_home: 2, pick_away: 1, points: null }])
    expect(await myPicks(JARN)).toEqual([expect.objectContaining({ pick_home: 2, pick_away: 1, latest_home: 3, latest_away: 1, latest_counts: false })])
    expect(await myPicks(MATTIAS)).toEqual([expect.objectContaining({ pick_home: null, pick_away: null, latest_home: 1, latest_away: 1, latest_counts: false })])
    // Nothing was deleted or rewritten.
    expect((await one<{ n: number }>('select count(*)::int as n from matchtips.prediction_submissions')).n).toBe(3)
    expect(await user(LOTTA, () => one('select deadline_corrected, deadline_correction_reason, deadline_correction_source_url from public.matchtips_matches($1)', [SEASON])))
      .toEqual({ deadline_corrected: true, deadline_correction_reason: 'Matchen startade 18:00 enligt shl.se, inte 19:00', deadline_correction_source_url: SRC })

    await result(m, 2, 1, 'regulation')
    expect(await board(LOTTA)).toEqual([
      { rank: 1, handle: 'jarnmannen', points: 3, tipped: 1, exact: 1, outcomes: 0 },
      { rank: 2, handle: 'mattias', points: 0, tipped: 0, exact: 0, outcomes: 0 },
    ])
  })

  it('a correction before the deadline locks at once, with real submission times', async () => {
    const m = await createMatch(60)
    await submit(JARN, m, 2, 1)
    const mid = (await one<{ t: string }>('select clock_timestamp()::text as t')).t
    await new Promise(r => setTimeout(r, 20))
    await submit(JARN, m, 3, 1)
    await db.query(`select matchtips_ops.correct_deadline($1, $2::timestamptz, $3, 'Nedsläpp 30 min tidigare enligt shl.se', 'daniel')`, [m, mid, SRC])
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 4, 1)', [m])))).toBe('55000')
    expect(await myPicks(JARN)).toEqual([expect.objectContaining({ pick_home: 2, pick_away: 1, latest_home: 3, latest_counts: false })])
    expect(await picks(MATTIAS, m)).toEqual([{ handle: 'jarnmannen', pick_home: 2, pick_away: 1, points: null }])
  })

  it('never later after the deadline, not even directly; corrections need a source, a reason and an operator', async () => {
    const m = await fixtureMatch({ startMin: -5 })
    const c = (at: string, src: string | null = SRC, reason: string | null = 'Bevis', op: string | null = 'daniel') =>
      codeOf(db.query(`select matchtips_ops.correct_deadline($1, ${at}, $2, $3, $4)`, [m, src, reason, op]))
    expect(await c(`now() + interval '1 hour'`)).toBe('22023')
    expect(await c(`now() - interval '1 hour'`, null)).toBe('22023')
    expect(await c(`now() - interval '1 hour'`, 'http://insecure.example')).toBe('22023')
    expect(await c(`now() - interval '1 hour'`, SRC, '  ')).toBe('22023')
    expect(await c(`now() - interval '1 hour'`, SRC, 'Bevis', 'Daniel M')).toBe('22023')
    expect(await codeOf(db.query(`update matchtips.matches set locks_at = now() + interval '1 hour' where id = $1`, [m]))).toBe('42501')
    expect(await codeOf(db.transaction(async (tx) => {
      await tx.query(`select set_config('matchtips.via_ops', 'on', true)`)
      await tx.query(`update matchtips.matches set locks_at = now() + interval '1 hour', scheduled_start = now() + interval '1 hour' where id = $1`, [m])
    }))).toBe('42501')
  })
})

// ── 6. Schedule changes ─────────────────────────────────────────────────────
describe('schedule', () => {
  it('before the deadline the game and its deadline move together, either way, but never into the past', async () => {
    const m = await createMatch(60)
    const at = () => one<{ s: number, l: number }>(`select extract(epoch from scheduled_start - now())::int / 60 as s, extract(epoch from locks_at - now())::int / 60 as l from matchtips.matches where id = $1`, [m])
    await db.query(`select matchtips_ops.reschedule($1, now() + interval '120 minutes', $2, 'Flyttad för TV', 'daniel')`, [m, SRC])
    expect(await at()).toEqual({ s: 120, l: 120 })
    await db.query(`select matchtips_ops.reschedule($1, now() + interval '30 minutes', $2, 'Flyttad tidigare', 'daniel')`, [m, SRC])
    expect(await at()).toEqual({ s: 30, l: 30 })
    expect(await codeOf(db.query(`select matchtips_ops.reschedule($1, now() - interval '5 minutes', $2, 'Fel', 'daniel')`, [m, SRC]))).toBe('22023')
  })

  it('postponed after the deadline: picks stay sealed and visible; the game moves, the deadline never does', async () => {
    const m = await fixtureMatch({ startMin: -5 })
    await fixtureSubmission(m, JARN, 1, 2, 2, 30)
    const lockBefore = (await one<{ l: string }>('select locks_at::text as l from matchtips.matches where id = $1', [m])).l
    await db.query('select matchtips_ops.postpone($1, $2, $3, $4)', [m, SRC, 'Uppskjuten: isproblem', 'daniel'])
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 1, 1)', [m])))).toBe('55000')
    expect(await codeOf(result(m, 1, 0, 'regulation'))).toBe('55000')
    expect(await codeOf(db.query(`select matchtips_ops.reschedule($1, now() - interval '1 day', $2, 'Fel håll', 'daniel')`, [m, SRC]))).toBe('22023')
    await db.query(`select matchtips_ops.reschedule($1, now() + interval '7 days', $2, 'Ny dag enligt shl.se', 'daniel')`, [m, SRC])
    expect(await one('select status, locks_at::text as l from matchtips.matches where id = $1', [m])).toEqual({ status: 'scheduled', l: lockBefore })
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 1, 1)', [m])))).toBe('55000')
    expect(await picks(MATTIAS, m)).toEqual([{ handle: 'jarnmannen', pick_home: 2, pick_away: 2, points: null }])
  })

  it('identity and teams never change; matches are never deleted or truncated; direct edits are refused', async () => {
    const m = await createMatch()
    expect(await codeOf(db.query(`update matchtips.matches set scheduled_start = scheduled_start + interval '1 hour' where id = $1`, [m]))).toBe('42501')
    expect(await codeOf(db.query('delete from matchtips.matches where id = $1', [m]))).toBe('42501')
    expect(await codeOf(db.query('truncate matchtips.matches cascade'))).toBe('42501')
    expect(await codeOf(db.transaction(async (tx) => {
      await tx.query(`select set_config('matchtips.via_ops', 'on', true)`)
      await tx.query(`update matchtips.matches set home_team = 'Färjestad BK', away_team = 'Djurgården' where id = $1`, [m])
    }))).toBe('42501')
    expect(await codeOf(db.query(`select matchtips_ops.create_match($1, 'Färjestad BK', 'Luleå HF', now() + interval '1 day', $2, null, 'Inte DIF', 'daniel')`, [SEASON, SRC]))).toBe('23514')
    expect(await codeOf(db.query(`select matchtips_ops.create_match($1, 'Djurgården', 'Luleå HF', now() - interval '1 minute', $2, null, 'Redan spelad', 'daniel')`, [SEASON, SRC]))).toBe('22023')
  })

  it('a void match is final', async () => {
    const m = await createMatch()
    await db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [m, SRC, 'Fel ordning hemma/borta', 'daniel'])
    expect(await codeOf(db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [m, SRC, 'Igen', 'daniel']))).toBe('55000')
    expect(await codeOf(db.query(`select matchtips_ops.reschedule($1, now() + interval '2 days', $2, 'Ny tid', 'daniel')`, [m, SRC]))).toBe('55000')
    expect(await codeOf(db.query(`select matchtips_ops.correct_deadline($1, now() - interval '1 minute', $2, 'Ny tid', 'daniel')`, [m, SRC]))).toBe('55000')
  })
})

// ── 6b. Postponed BEFORE the deadline, new date not yet known ───────────────
describe('postponed before the deadline', () => {
  const postpone = (m: string) => db.query('select matchtips_ops.postpone($1, $2, $3, $4)', [m, SRC, 'Uppskjuten, nytt datum ej klart', 'daniel'])
  const state = (m: string) => one<{ status: string, locks_at: Date | null }>('select status, locks_at from matchtips.matches where id = $1', [m])

  it('pauses predictions: no submissions, nothing revealed or counted; picks made before the pause are kept', async () => {
    const m = await createMatch(60)
    await submit(JARN, m, 2, 1)
    await postpone(m)
    expect(await state(m)).toEqual({ status: 'postponed', locks_at: null })
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 3, 1)', [m])))).toBe('55000')
    expect(await user(MATTIAS, () => codeOf(db.query('select public.matchtips_submit($1, 0, 0)', [m])))).toBe('55000')
    expect(await picks(MATTIAS, m)).toEqual([])
    expect(await myPicks(JARN)).toEqual([expect.objectContaining({ pick_home: 2, pick_away: 1, latest_counts: true })])
    expect(await user(MATTIAS, () => one('select locks_at, locked, status from public.matchtips_matches($1)', [SEASON]))).toEqual({ locks_at: null, locked: false, status: 'postponed' })
    expect((await board(MATTIAS)).map(r => r.tipped)).toEqual([0, 0])
    // Even past the functions: no submission while paused.
    expect(await codeOf(fixtureSubmission(m, MATTIAS, 1, 1, 1, 0))).toBe('55000')
  })

  it('the old deadline passing changes nothing; the new date resumes predictions with a new deadline, and nothing was revealed in between', async () => {
    const m = await createMatch(0.03) // ~2 seconds from now
    await submit(JARN, m, 2, 1)
    await postpone(m)
    await new Promise(r => setTimeout(r, 2500)) // the original deadline has now passed
    expect(await picks(MATTIAS, m)).toEqual([])
    expect(await user(JARN, () => codeOf(db.query('select public.matchtips_submit($1, 3, 1)', [m])))).toBe('55000')
    expect((await board(MATTIAS)).map(r => r.tipped)).toEqual([0, 0])

    await db.query(`select matchtips_ops.reschedule($1, now() + interval '7 days', $2, 'Nytt datum enligt shl.se', 'daniel')`, [m, SRC])
    const resumed = await one<{ status: string, open: boolean }>(`select status, locks_at = scheduled_start and locks_at > now() + interval '6 days' as open from matchtips.matches where id = $1`, [m])
    expect(resumed).toEqual({ status: 'scheduled', open: true })
    expect((await submit(JARN, m, 3, 1)).revision).toBe(2)
    expect((await submit(MATTIAS, m, 0, 0)).revision).toBe(1)
    expect(await picks(LOTTA, m)).toEqual([])
    expect((await log(m)).map(l => [l.action, (l.new_values as Row).locks_at === null])).toEqual([['created', false], ['postponed', true], ['rescheduled', false]])
  })

  it('a paused match: no result, no deadline correction, no second postponement; voiding it works', async () => {
    const m = await createMatch(60)
    await postpone(m)
    expect(await codeOf(postpone(m))).toBe('55000')
    expect(await codeOf(db.query(`select matchtips_ops.correct_deadline($1, now() - interval '1 minute', $2, 'Spelades ändå', 'daniel')`, [m, SRC]))).toBe('55000')
    expect(await codeOf(db.query(`select matchtips_ops.reschedule($1, now() - interval '1 minute', $2, 'Redan', 'daniel')`, [m, SRC]))).toBe('22023')
    await db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [m, SRC, 'Spelas inte denna säsong', 'daniel'])
    expect(await state(m)).toEqual({ status: 'void', locks_at: null })
  })

  it('a passed deadline can never be withdrawn: postponing after it keeps it, and a direct pause is refused', async () => {
    const m = await fixtureMatch({ startMin: -5 })
    await postpone(m)
    expect((await state(m)).locks_at).not.toBeNull()
    expect(await codeOf(db.transaction(async (tx) => {
      await tx.query(`select set_config('matchtips.via_ops', 'on', true)`)
      await tx.query(`update matchtips.matches set locks_at = null where id = $1`, [m])
    }))).toBe('42501')
  })
})

// ── 6c. MatchCard references ────────────────────────────────────────────────
describe('fixture references', () => {
  const create = (ref: string | null, min = 60) => db.query(
    `select matchtips_ops.create_match($1, 'Djurgården', 'Färjestad BK', now() + $2::numeric * interval '1 minute', $3, $4, 'Verifierad', 'daniel') as id`,
    [SEASON, min, SRC, ref])

  it('one active match per fixture reference; a void match frees it; no reference is fine for many', async () => {
    const first = (await create('dif-abc@dif.se')).rows[0] as { id: string }
    expect(await codeOf(create('dif-abc@dif.se', 90))).toBe('23505')
    await create(null)
    await create(null, 90)
    const other = (await create('dif-def@dif.se', 120)).rows[0] as { id: string }
    expect(await codeOf(db.query(`select matchtips_ops.record_reconciliation($1, 'dif-abc@dif.se', 'consistent', $2, 'Fel match', 'daniel')`, [other.id, SRC]))).toBe('23505')
    await db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [first.id, SRC, 'Dubblett', 'daniel'])
    expect(await codeOf(create('dif-abc@dif.se', 150))).toBe('ok')
  })
})

// ── 7. Results, corrections, scoring, leaderboard ───────────────────────────
describe('results and scoring', () => {
  it('scores 3 exact / 1 right outcome / 0 otherwise, on the 60-minute score', async () => {
    const cases = await rows<{ p: number | null }>(`
      select matchtips.points(ph, pa, rh, ra) as p from (values
        (3, 3, 3, 3), (2, 2, 3, 3), (4, 3, 3, 3), (2, 1, 2, 1), (3, 0, 2, 1), (1, 2, 2, 1), (0, 0, 1, 0), (1, 1, null, null)
      ) v(ph, pa, rh, ra)`)
    expect(cases.map(c => c.p)).toEqual([3, 1, 0, 3, 1, 0, 0, null])
  })

  it('DIF–Växjö 3–3 after 60, 4–3 after overtime: a 3–3 pick scores 3, a 4–3 pick scores 0', async () => {
    const m = await fixtureMatch({ startMin: -150 })
    await fixtureSubmission(m, JARN, 1, 3, 3, 200)
    await fixtureSubmission(m, MATTIAS, 1, 4, 3, 200)
    await result(m, 3, 3, 'overtime')
    expect(await picks(LOTTA, m)).toEqual([
      { handle: 'jarnmannen', pick_home: 3, pick_away: 3, points: 3 },
      { handle: 'mattias', pick_home: 4, pick_away: 3, points: 0 },
    ])
  })

  it('refuses results that cannot be 60-minute scores, before the start, or for postponed and void matches', async () => {
    const m = await fixtureMatch({ startMin: -100 })
    expect(await codeOf(result(m, 2, 2, 'regulation'))).toBe('23514')
    expect(await codeOf(result(m, 3, 2, 'overtime'))).toBe('23514')
    expect(await codeOf(result(m, 3, 2, 'shootout'))).toBe('23514')
    expect(await codeOf(result(m, 31, 0, 'regulation'))).toBe('23514')
    expect(await codeOf(result(m, 1, 0, 'penalties'))).toBe('23514')
    const future = await createMatch()
    expect(await codeOf(result(future, 1, 0, 'regulation'))).toBe('55000')
    await db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [m, SRC, 'Avbruten', 'daniel'])
    expect(await codeOf(result(m, 1, 0, 'regulation'))).toBe('55000')
  })

  it('a correction is a new revision: points and ranks follow it, and both revisions are logged', async () => {
    const m = await fixtureMatch({ startMin: -150 })
    await fixtureSubmission(m, JARN, 1, 2, 1, 200)
    await fixtureSubmission(m, MATTIAS, 1, 2, 2, 200)
    await result(m, 2, 1, 'regulation')
    expect((await board(LOTTA)).map(r => [r.handle, r.points])).toEqual([['jarnmannen', 3], ['mattias', 0]])
    await result(m, 2, 2, 'shootout', 'Rättad: 2–2 efter 60, avgjord på straffar')
    expect((await board(LOTTA)).map(r => [r.handle, r.points])).toEqual([['mattias', 3], ['jarnmannen', 0]])
    expect(await user(LOTTA, () => one('select result_home_60, result_away_60, decided_in, result_revision, result_note from public.matchtips_matches($1)', [SEASON])))
      .toEqual({ result_home_60: 2, result_away_60: 2, decided_in: 'shootout', result_revision: 2, result_note: 'Rättad: 2–2 efter 60, avgjord på straffar' })
    const results = (await log(m)).filter(l => l.action === 'result')
    expect(results.map(r => [r.old_values, r.new_values])).toEqual([
      [null, { home_60: 2, away_60: 1, decided_in: 'regulation', revision: 1 }],
      [{ home_60: 2, away_60: 1, decided_in: 'regulation', revision: 1 }, { home_60: 2, away_60: 2, decided_in: 'shootout', revision: 2 }],
    ])
  })

  it('leaderboard: total points, shared ranks, matches tipped; void and other seasons count for nothing', async () => {
    await user(LOTTA, () => db.query('select public.matchtips_join($1)', [CONSENT]))
    const a = await fixtureMatch({ startMin: -300 })
    const b = await fixtureMatch({ startMin: -200, home: 'Rögle BK', away: 'Djurgården' })
    const voided = await fixtureMatch({ startMin: -100 })
    const other = await fixtureMatch({ startMin: -100, season: '2025/26' })
    const open = await createMatch()
    await fixtureSubmission(a, JARN, 1, 2, 1, 400)
    await fixtureSubmission(a, MATTIAS, 1, 3, 1, 400)
    await fixtureSubmission(b, JARN, 1, 0, 0, 300)
    await fixtureSubmission(b, MATTIAS, 1, 1, 1, 300)
    await fixtureSubmission(voided, JARN, 1, 5, 0, 200)
    await fixtureSubmission(other, LOTTA, 1, 1, 0, 200)
    await submit(LOTTA, open, 2, 2)
    await result(a, 2, 1, 'regulation') // Järnmannen 3, Mattias 1
    await result(b, 0, 0, 'overtime') // Järnmannen 3, Mattias 1
    await result(voided, 5, 0, 'regulation')
    await db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [voided, SRC, 'Avbruten i andra perioden', 'daniel'])
    await result(other, 1, 0, 'regulation')
    expect(await board(MATTIAS)).toEqual([
      { rank: 1, handle: 'jarnmannen', points: 6, tipped: 2, exact: 2, outcomes: 0 },
      { rank: 2, handle: 'mattias', points: 2, tipped: 2, exact: 0, outcomes: 2 },
      { rank: 3, handle: 'lotta_g', points: 0, tipped: 0, exact: 0, outcomes: 0 },
    ])
    await result(a, 3, 1, 'regulation', 'Rättad efter granskning') // Järnmannen 1, Mattias 3: 4 each
    expect((await board(MATTIAS)).map(r => [r.rank, r.handle, r.points])).toEqual([[1, 'jarnmannen', 4], [1, 'mattias', 4], [3, 'lotta_g', 0]])
  })
})

// ── 8. The operations log ───────────────────────────────────────────────────
describe('operations log', () => {
  it('every operation is logged with old/new values, source, reason, declared operator and database role', async () => {
    const m = await createMatch(60)
    await db.query(`select matchtips_ops.reschedule($1, now() + interval '90 minutes', $2, 'Flyttad', 'daniel')`, [m, SRC])
    await db.query(`select matchtips_ops.record_reconciliation($1, 'manual-hockey-herr-2026-11-12-farjestad', 'consistent', $2, 'MatchCard och shl.se stämmer', 'daniel')`, [m, SRC])
    await db.query('select matchtips_ops.void_match($1, $2, $3, $4)', [m, SRC, 'Test av void', 'daniel'])
    const l = await log(m)
    expect(l.map(r => r.action)).toEqual(['created', 'rescheduled', 'reconciled', 'voided'])
    expect(new Set(l.map(r => r.operator_declared))).toEqual(new Set(['daniel']))
    expect(new Set(l.map(r => r.db_role))).toEqual(new Set(['postgres']))
    expect(l[2]!.new_values).toMatchObject({ fixture_ref: 'manual-hockey-herr-2026-11-12-farjestad', outcome: 'consistent' })
    expect(await one('select fixture_ref from matchtips.matches where id = $1', [m])).toEqual({ fixture_ref: 'manual-hockey-herr-2026-11-12-farjestad' })
    expect(await codeOf(db.query(`select matchtips_ops.record_reconciliation($1, null, 'ok', $2, 'Fel utfall', 'daniel')`, [m, SRC]))).toBe('22023')
  })

  it('the log refuses edits, deletes, truncation and direct inserts', async () => {
    const m = await createMatch()
    expect(await codeOf(db.query(`update matchtips.match_log set reason = 'ändrad'`))).toBe('42501')
    expect(await codeOf(db.query('delete from matchtips.match_log'))).toBe('42501')
    expect(await codeOf(db.query('truncate matchtips.match_log'))).toBe('42501')
    expect(await codeOf(db.query(`insert into matchtips.match_log (match_id, action, new_values, source_url, reason, operator_declared) values ($1, 'voided', '{}', $2, 'Smugglad', 'daniel')`, [m, SRC]))).toBe('42501')
    // A failed operation leaves no trace: same transaction.
    await codeOf(db.query(`select matchtips_ops.correct_deadline($1, now() + interval '1 day', $2, 'Fel håll', 'daniel')`, [m, SRC]))
    expect((await log(m)).map(r => r.action)).toEqual(['created'])
    // The guard is off again after an operation.
    expect((await one<{ v: string | null }>(`select current_setting('matchtips.via_ops', true) as v`)).v ?? '').not.toBe('on')
  })
})

// ── 9. Account deletion ─────────────────────────────────────────────────────
describe('account deletion', () => {
  it('deleting an account removes participation and every submission; ranks may shift; the log stays', async () => {
    const m = await fixtureMatch({ startMin: -100 })
    await fixtureSubmission(m, JARN, 1, 2, 1, 200)
    await fixtureSubmission(m, JARN, 2, 2, 0, 150)
    await fixtureSubmission(m, MATTIAS, 1, 1, 0, 150)
    await result(m, 2, 0, 'regulation')
    expect((await board(LOTTA)).map(r => [r.rank, r.handle])).toEqual([[1, 'jarnmannen'], [2, 'mattias']])
    await db.query('delete from auth.users where id = $1', [JARN])
    expect((await one<{ n: number }>('select count(*)::int as n from matchtips.prediction_submissions where profile_id = $1', [JARN])).n).toBe(0)
    expect((await one<{ n: number }>('select count(*)::int as n from matchtips.participants where profile_id = $1', [JARN])).n).toBe(0)
    expect((await board(LOTTA)).map(r => [r.rank, r.handle, r.points])).toEqual([[1, 'mattias', 1]])
    expect((await log(m)).map(r => r.action)).toEqual(['result'])
  })
})

// ── 10. The pgTAP suite, on top of existing data ────────────────────────────
describe('supabase/tests/matchtipset_rls.test.sql', () => {
  it('passes against the migrated database, and leaves real data untouched', async () => {
    const fresh = await createSupabaseLikeDb()
    await seedRealData(fresh)
    const before = await realDataSnapshot(fresh)
    const { lines, planned } = await runPgTapFile(fresh, 'matchtipset_rls.test.sql')
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(fresh)).toEqual(before)
    expect((await fresh.query<{ n: number }>('select (select count(*) from matchtips.matches) + (select count(*) from matchtips.participants) + (select count(*) from matchtips.prediction_submissions) as n')).rows[0]!.n).toBe(0)
  })
})
