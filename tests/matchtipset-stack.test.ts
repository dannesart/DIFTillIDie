import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * Matchtipset against a real, disposable LOCAL Supabase stack (CI:
 * .github/workflows/database.yml): what PGlite can't show.
 *  - Concurrency, over the real API's pooled connections: parallel
 *    submissions, a deadline correction racing them, leaving mid-flight.
 *  - Exposure: the matchtips schemas aren't reachable through REST or
 *    GraphQL; anonymous requests are refused.
 *  - Account deletion through the real Auth admin API.
 *
 * It creates users, a match and predictions, so it refuses to run unless
 * MATCHTIPSET_STACK=local and the API is on localhost. Never point it at the
 * hosted project. The service-role key it uses is the local stack's own,
 * printed by `supabase status`; it only creates and deletes test users.
 */

const env = process.env
const enabled = env.MATCHTIPSET_STACK === 'local'
const apiUrl = env.API_URL ?? ''
const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY ?? ''
const serviceKey = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY ?? ''
const dbUrl = env.DB_URL ?? ''
const local = (u: string) => /^(http|postgres(ql)?):\/\/[^@/]*@?(127\.0\.0\.1|localhost)[:/]/.test(u)

const SEASON = '2026/27'
/** supabase-js and postgres.js send nothing until awaited: start a request now. */
const start = <T>(p: PromiseLike<T>) => Promise.resolve(p)
const SRC = 'https://www.difhockey.se/game-schedule'
const CONSENT = 'matchtipset-2026-11-09'

describe.skipIf(!enabled)('Matchtipset on a local Supabase stack', () => {
  let sql: postgres.Sql
  let admin: SupabaseClient
  const run = Date.now().toString(36)

  beforeAll(() => {
    if (!local(apiUrl) || !local(dbUrl)) throw new Error('Refusing to run: API_URL and DB_URL must point at a local stack (127.0.0.1/localhost).')
    sql = postgres(dbUrl, { max: 4, onnotice: () => {} })
    admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  })
  afterAll(async () => { await sql?.end() })

  /** A signed-in supporter with a profile (and, unless told otherwise, a participant). */
  async function supporter(name: string, join = true) {
    const email = `stack-${name}-${run}@example.test`
    const password = `pw-${run}-${name}-Aa1!`
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) throw created.error
    const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedIn = await client.auth.signInWithPassword({ email, password })
    if (signedIn.error) throw signedIn.error
    const id = created.data.user!.id
    const handle = `st_${name}_${run}`.slice(0, 20)
    const profile = await client.from('profiles').insert({ id, display_name: name, handle })
    if (profile.error) throw profile.error
    if (join) {
      const joined = await client.rpc('matchtips_join', { p_consent_version: CONSENT })
      if (joined.error) throw joined.error
    }
    return { id, client, handle }
  }

  const openMatch = async (minutes = 60) =>
    (await sql`select matchtips_ops.create_match(${SEASON}, 'Djurgården', ${`Stack IK ${run}`}, now() + ${minutes} * interval '1 minute', ${SRC}, null, 'CI: testmatch', 'ci') as id`)[0]!.id as string

  it('parallel submissions from one supporter get distinct, consecutive revisions; the last one is the pick', async () => {
    const ada = await supporter('ada')
    const match = await openMatch()
    const goals = Array.from({ length: 20 }, (_, i) => [i % 7, (i * 3) % 5] as const)
    const results = await Promise.all(goals.map(([h, a]) => start(ada.client.rpc('matchtips_submit', { p_match: match, p_home: h, p_away: a }))))
    expect(results.map(r => r.error)).toEqual(goals.map(() => null))
    const revisions = results.map(r => (r.data as { revision: number }[])[0]!.revision).sort((a, b) => a - b)
    expect(revisions).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))

    const last = results.findIndex(r => (r.data as { revision: number }[])[0]!.revision === 20)
    const mine = await ada.client.rpc('matchtips_my_picks', { p_season: SEASON })
    expect(mine.data).toEqual([expect.objectContaining({ match_id: match, pick_home: goals[last]![0], pick_away: goals[last]![1], latest_counts: true })])
    // Revision order and submission time agree (the time is read after the lock).
    const rows = await sql`select revision, submitted_at from matchtips.prediction_submissions where match_id = ${match} order by revision`
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.submitted_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1]!.submitted_at.getTime())
  })

  it('a deadline correction racing submissions: whatever was accepted, the pick is the last revision before the corrected deadline', async () => {
    const bo = await supporter('bo')
    const match = await openMatch()
    const burst = (n: number) => Array.from({ length: n }, (_, i) => start(bo.client.rpc('matchtips_submit', { p_match: match, p_home: i % 6, p_away: 1 })))
    const first = burst(10)
    await new Promise(r => setTimeout(r, 30))
    const correction = start(sql`select matchtips_ops.correct_deadline(${match}, clock_timestamp(), ${SRC}, 'CI: rättad deadline mitt i', 'ci')`)
    const second = burst(10)
    const settled = await Promise.all([...first, ...second])
    await correction

    // Afterwards nothing is accepted.
    expect((await bo.client.rpc('matchtips_submit', { p_match: match, p_home: 1, p_away: 1 })).error?.code).toBe('55000')
    // Refusals are only "locked".
    expect(new Set(settled.filter(r => r.error).map(r => r.error!.code))).toEqual(new Set(settled.some(r => r.error) ? ['55000'] : []))

    // Compared in SQL: a JS Date has only milliseconds, the deadline has microseconds.
    const valid = await sql`select s.revision, s.home_goals, s.away_goals from matchtips.prediction_submissions s join matchtips.matches m on m.id = s.match_id where s.match_id = ${match} and s.submitted_at < m.locks_at order by s.revision desc limit 1`
    const cia = await supporter('cia', false)
    const shown = await cia.client.rpc('matchtips_picks', { p_match: match })
    expect(shown.error).toBeNull()
    expect(shown.data).toEqual(valid.length ? [{ handle: bo.handle, pick_home: valid[0]!.home_goals, pick_away: valid[0]!.away_goals, points: null }] : [])
  })

  it('deterministic: a submission that waits on an uncommitted correction is judged against the corrected deadline', async () => {
    const gus = await supporter('gus')
    const match = await openMatch()
    expect((await gus.client.rpc('matchtips_submit', { p_match: match, p_home: 1, p_away: 0 })).error).toBeNull()
    let pending: Promise<{ error: { code?: string } | null }> | undefined
    let waited = false
    await sql.begin(async (tx) => {
      // The correction holds the match row until this transaction commits.
      await tx`select matchtips_ops.correct_deadline(${match}, clock_timestamp(), ${SRC}, 'CI: deterministisk rättning', 'ci')`
      pending = start(gus.client.rpc('matchtips_submit', { p_match: match, p_home: 5, p_away: 0 }))
      // Wait until the submission is provably blocked on that lock.
      for (let i = 0; i < 100 && !waited; i++) {
        const [w] = await sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%matchtips_submit%'`
        waited = w!.n > 0
        if (!waited) await new Promise(r => setTimeout(r, 50))
      }
    })
    expect(waited).toBe(true)
    expect((await pending!).error?.code).toBe('55000')
    const [n] = await sql`select count(*)::int as n from matchtips.prediction_submissions where match_id = ${match}`
    expect(n!.n).toBe(1)
  })

  it('postponed before the deadline: the API refuses submissions and reveals nothing until a new date', async () => {
    const hal = await supporter('hal')
    const ivy = await supporter('ivy')
    const match = await openMatch()
    await hal.client.rpc('matchtips_submit', { p_match: match, p_home: 2, p_away: 2 })
    await sql`select matchtips_ops.postpone(${match}, ${SRC}, 'CI: uppskjuten', 'ci')`
    expect((await hal.client.rpc('matchtips_submit', { p_match: match, p_home: 3, p_away: 2 })).error?.code).toBe('55000')
    expect((await ivy.client.rpc('matchtips_picks', { p_match: match })).data).toEqual([])
    await sql`select matchtips_ops.reschedule(${match}, now() + interval '3 days', ${SRC}, 'CI: nytt datum', 'ci')`
    expect((await hal.client.rpc('matchtips_submit', { p_match: match, p_home: 3, p_away: 2 })).error).toBeNull()
    expect((await ivy.client.rpc('matchtips_picks', { p_match: match })).data).toEqual([])
  })

  it('leaving while submissions are in flight leaves nothing behind', async () => {
    const dan = await supporter('dan')
    const match = await openMatch()
    const inFlight = Array.from({ length: 10 }, () => start(dan.client.rpc('matchtips_submit', { p_match: match, p_home: 2, p_away: 2 })))
    const leaving = start(dan.client.rpc('matchtips_leave', { p_confirmed: true }))
    await Promise.all([...inFlight, leaving])
    const [left] = await sql`select count(*)::int as n from matchtips.participants where profile_id = ${dan.id}`
    const [subs] = await sql`select count(*)::int as n from matchtips.prediction_submissions where profile_id = ${dan.id}`
    // Leaving won; any submission that ran after it was refused (not a participant), none survived it.
    expect(left!.n).toBe(0)
    expect(subs!.n).toBe(0)
  })

  it('the matchtips schemas are not reachable through REST or GraphQL; anonymous calls are refused', async () => {
    const eve = await supporter('eve')
    const token = (await eve.client.auth.getSession()).data.session!.access_token
    const get = (path: string, headers: Record<string, string> = {}) =>
      fetch(`${apiUrl}${path}`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}`, ...headers } })

    for (const [schema, table] of [['matchtips', 'prediction_submissions'], ['matchtips', 'matches'], ['matchtips_ops', 'create_match']]) {
      const res = await get(`/rest/v1/${table}`, { 'Accept-Profile': schema! })
      expect(res.ok).toBe(false)
      expect((await res.json()).code).toBe('PGRST106')
    }
    const ops = await fetch(`${apiUrl}/rest/v1/rpc/void_match`, {
      method: 'POST',
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${token}`, 'Content-Profile': 'matchtips_ops', 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_match: '00000000-0000-4000-8000-000000000000', p_source_url: SRC, p_reason: 'nope', p_operator: 'eve' }),
    })
    expect(ops.ok).toBe(false)

    const gql = await fetch(`${apiUrl}/graphql/v1`, {
      method: 'POST',
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __schema { types { name } } }' }),
    })
    const types: string[] = ((await gql.json()).data?.__schema?.types ?? []).map((t: { name: string }) => t.name.toLowerCase())
    expect(types.filter(t => /prediction|participant|match_?log/.test(t))).toEqual([])

    const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    for (const [fn, args] of [['matchtips_leaderboard', { p_season: SEASON }], ['matchtips_picks', { p_match: '00000000-0000-4000-8000-000000000000' }], ['matchtips_join', { p_consent_version: CONSENT }]] as const) {
      const r = await anon.rpc(fn, args)
      expect(r.error, fn).not.toBeNull()
    }
  })

  it('deleting the account through Auth removes every submission; the operations log stays', async () => {
    const fia = await supporter('fia')
    const match = await openMatch()
    await fia.client.rpc('matchtips_submit', { p_match: match, p_home: 1, p_away: 0 })
    await fia.client.rpc('matchtips_submit', { p_match: match, p_home: 2, p_away: 0 })
    expect((await admin.auth.admin.deleteUser(fia.id)).error).toBeNull()
    const [subs] = await sql`select count(*)::int as n from matchtips.prediction_submissions where profile_id = ${fia.id}`
    const [logged] = await sql`select count(*)::int as n from matchtips.match_log where match_id = ${match}`
    expect(subs!.n).toBe(0)
    expect(logged!.n).toBe(1)
  })
})
