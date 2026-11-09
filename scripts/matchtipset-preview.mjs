#!/usr/bin/env node
/*
 * Matchtipset — LOCAL journey preview (development only). `npm run preview:matchtipset`
 *
 * Runs the real app (the production build in .output) against a small mock
 * of the Supabase API on 127.0.0.1, with clearly labelled TEST fixtures, so
 * the whole journey can be tried by hand: an open match, saving and
 * changing a tip, the deadline passing and tips becoming visible, a verified
 * result awarding points, and the table updating. Nothing here talks to the
 * hosted project: the app's Supabase URL is this mock, and the script refuses
 * to start if it would be anything else. All state lives in memory and is
 * gone when the script stops.
 *
 * The mock copies the database's Matchtipset rules (see
 * supabase/migrations/…_matchtipset_foundation.sql) closely enough to try the
 * UI: the deadline, append-only revisions, the effective pick, secrecy before
 * the deadline, 3/1/0 points, shared ranks, opt-in and opt-out. It is not
 * the database and proves nothing about it; the database's own tests do that.
 *
 * Signing in: any e-mail address, then the code 123456. A local profile is
 * made for it. The operator panel (what the owner does in the SQL editor)
 * is at http://127.0.0.1:3917/.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'

const APP_PORT = Number(process.env.PREVIEW_APP_PORT ?? 3916)
const MOCK_PORT = Number(process.env.PREVIEW_MOCK_PORT ?? 3917)
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`
const CONSENT = 'lokal-testdata'
const SEASON = '2026/27'
const CODE = '123456'

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(MOCK_URL)) throw new Error('The preview must only ever use the local mock.')
if (!existsSync('.output/server/index.mjs')) {
  console.error('No build found. Run `npm run build` first, then `npm run preview:matchtipset`.')
  process.exit(1)
}

/* ── State: TEST fixtures, in memory only ──────────────────────────────── */
const uuid = () => crypto.randomUUID()
const now = () => Date.now()
let state

function seed() {
  const jarnis = { id: uuid(), email: 'test-jarnis@lokal.test', handle: 'test_jarnis', display_name: 'TEST Järnis', bio: null, avatar: 'tricolor' }
  const mattias = { id: uuid(), email: 'test-mattias@lokal.test', handle: 'test_mattias', display_name: 'TEST Mattias', bio: null, avatar: 'puck' }
  const played = { id: uuid(), home: 'Djurgården', away: 'Växjö Lakers', start: now() - 3 * 864e5 }
  const open = { id: uuid(), home: 'Färjestad BK', away: 'Djurgården', start: now() + 2 * 36e5 }
  state = {
    profiles: [jarnis, mattias],
    participants: new Map([[jarnis.id, now() - 7 * 864e5], [mattias.id, now() - 6 * 864e5]]),
    matches: [played, open].map(m => ({
      id: m.id, season: SEASON, home_team: m.home, away_team: m.away,
      scheduled_start: m.start, locks_at: m.start, status: 'scheduled', void_reason: null,
      result: null, result_revision: 0, result_note: null, official_url: 'https://example.test/lokal-testmatch',
    })),
    submissions: [],
    log: [],
  }
  // `at`: when it was submitted, always before both now and the match's deadline.
  const sub = (m, p, home, away, at) => state.submissions.push({ match: m.id, profile: p.id, revision: 1 + state.submissions.filter(s => s.match === m.id && s.profile === p.id).length, home, away, at })
  sub(played, jarnis, 3, 3, played.start - 864e5)
  sub(played, mattias, 2, 1, played.start - 864e5)
  sub(open, jarnis, 2, 3, now() - 36e5)
  sub(open, mattias, 1, 1, now() - 18e5)
  state.matches[0].result = { home: 3, away: 3, decided_in: 'overtime' }
  state.matches[0].result_revision = 1
  state.matches[0].result_note = 'TESTDATA: 3–3 efter 60, avgjord i förlängning'
  state.log.push({ at: now(), text: 'Testdata skapad: en spelad match (3–3, förlängning) och en öppen match om två timmar.' })
}
seed()

/* ── The rules, as the database has them ───────────────────────────────── */
const iso = t => (t === null ? null : new Date(t).toISOString())
const sign = n => Math.sign(n)
const locked = m => m.locks_at !== null && now() >= m.locks_at
const effective = (m, pid) => state.submissions
  .filter(s => s.match === m.id && s.profile === pid && (m.locks_at === null || s.at < m.locks_at))
  .sort((a, b) => b.revision - a.revision)[0] ?? null
const points = (pick, m) => {
  if (!pick || m.status !== 'scheduled' || !m.result) return null
  if (pick.home === m.result.home && pick.away === m.result.away) return 3
  return sign(pick.home - pick.away) === sign(m.result.home - m.result.away) ? 1 : 0
}
const profile = id => state.profiles.find(p => p.id === id)
const fail = (status, code, message) => Object.assign(new Error(message), { status, code })

const matchRow = m => ({
  id: m.id, season: m.season, home_team: m.home_team, away_team: m.away_team,
  scheduled_start: iso(m.scheduled_start), locks_at: iso(m.locks_at), locked: m.locks_at === null ? null : locked(m),
  status: m.status, void_reason: m.void_reason,
  result_home_60: m.result?.home ?? null, result_away_60: m.result?.away ?? null, decided_in: m.result?.decided_in ?? null, result_revision: m.result_revision,
  result_source_url: m.result ? 'https://example.test/lokal-matchrapport' : null, result_note: m.result_note,
  deadline_corrected: false, deadline_correction_reason: null, deadline_correction_source_url: null,
  official_url: m.official_url,
})

const rpc = {
  matchtips_consent_version: () => CONSENT,
  matchtips_me: uid => [{ participating: state.participants.has(uid), opted_in_at: iso(state.participants.get(uid) ?? null), consent_version: state.participants.has(uid) ? CONSENT : null }],
  matchtips_matches: (_, a) => state.matches.filter(m => m.season === a.p_season).sort((x, y) => x.scheduled_start - y.scheduled_start).map(matchRow),
  matchtips_my_picks: (uid, a) => state.matches.filter(m => m.season === a.p_season).flatMap((m) => {
    const mine = state.submissions.filter(s => s.match === m.id && s.profile === uid).sort((x, y) => y.revision - x.revision)
    if (!mine.length) return []
    const e = effective(m, uid)
    return [{ match_id: m.id, pick_home: e?.home ?? null, pick_away: e?.away ?? null, points: points(e, m), latest_home: mine[0].home, latest_away: mine[0].away, latest_submitted_at: iso(mine[0].at), latest_counts: m.locks_at === null || mine[0].at < m.locks_at }]
  }),
  matchtips_picks: (_, a) => {
    const m = state.matches.find(x => x.id === a.p_match)
    if (!m || !locked(m)) return []
    return [...state.participants.keys()].map(pid => ({ p: profile(pid), e: effective(m, pid) })).filter(x => x.e && x.p)
      .map(x => ({ handle: x.p.handle, pick_home: x.e.home, pick_away: x.e.away, points: points(x.e, m) })).sort((x, y) => x.handle.localeCompare(y.handle))
  },
  matchtips_leaderboard: (_, a) => {
    const counted = state.matches.filter(m => m.season === a.p_season && m.status !== 'void' && locked(m))
    const rows = [...state.participants.keys()].map(profile).filter(Boolean).map((p) => {
      const ps = counted.map(m => ({ e: effective(m, p.id), m })).filter(x => x.e).map(x => points(x.e, x.m))
      return { handle: p.handle, points: ps.reduce((n, x) => n + (x ?? 0), 0), matches_tipped: ps.length, exact_scores: ps.filter(x => x === 3).length, correct_outcomes: ps.filter(x => x === 1).length }
    })
    return rows.map(r => ({ rank: 1 + rows.filter(o => o.points > r.points).length, ...r })).sort((x, y) => x.rank - y.rank || x.handle.localeCompare(y.handle))
  },
  matchtips_join: (uid, a) => {
    if (!profile(uid)) throw fail(403, '42501', 'only a signed-in supporter with a profile can join Matchtipset')
    if (a.p_consent_version !== CONSENT) throw fail(400, '22023', 'consent to the current Matchtipset terms is required')
    if (!state.participants.has(uid)) state.participants.set(uid, now())
    return iso(state.participants.get(uid))
  },
  matchtips_leave: (uid, a) => {
    if (a.p_confirmed !== true) throw fail(400, '22023', 'leaving Matchtipset must be confirmed')
    const before = state.submissions.length
    state.submissions = state.submissions.filter(s => s.profile !== uid)
    state.participants.delete(uid)
    return before - state.submissions.length
  },
  matchtips_submit: (uid, a) => {
    if (!state.participants.has(uid)) throw fail(403, '42501', 'join Matchtipset before predicting')
    const ok = n => Number.isInteger(n) && n >= 0 && n <= 30
    if (!ok(a.p_home) || !ok(a.p_away)) throw fail(400, '22023', 'goals must be whole numbers from 0 to 30')
    const m = state.matches.find(x => x.id === a.p_match)
    if (!m) throw fail(400, 'P0002', 'no such match')
    if (m.locks_at === null) throw fail(400, '55000', 'predictions are paused: the match is postponed')
    if (m.status === 'void' || now() >= m.locks_at) throw fail(400, '55000', 'predictions for this match are locked')
    const revision = 1 + state.submissions.filter(s => s.match === m.id && s.profile === uid).length
    if (revision > 50) throw fail(400, '54000', 'too many changes to this prediction')
    const at = now()
    state.submissions.push({ match: m.id, profile: uid, revision, home: a.p_home, away: a.p_away, at })
    return [{ revision, submitted_at: iso(at), locks_at: iso(m.locks_at) }]
  },
}

/* ── A tiny Supabase-shaped HTTP API ───────────────────────────────────── */
const sessions = new Map() // access token → user id
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')

function sessionFor(p) {
  const exp = Math.floor(now() / 1000) + 3600
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: p.id, role: 'authenticated', email: p.email, exp, iss: 'matchtipset-local-preview' })}.local`
  sessions.set(token, p.id)
  const user = { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() }
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `refresh-${token}`, user }
}

function userFor(email) {
  const e = String(email ?? '').trim().toLowerCase()
  let p = state.profiles.find(x => x.email === e)
  if (!p) {
    const base = (e.split('@')[0] ?? 'supporter').replace(/[^a-z0-9_]/g, '_').slice(0, 14) || 'supporter'
    let handle = base.length >= 3 ? base : `${base}_test`
    while (state.profiles.some(x => x.handle === handle)) handle = `${base.slice(0, 14)}_${Math.floor(Math.random() * 900 + 100)}`
    p = { id: uuid(), email: e, handle, display_name: `${base} (lokal test)`, bio: null, avatar: 'himmel' }
    state.profiles.push(p)
  }
  return p
}

const read = req => new Promise((res) => {
  let s = ''
  req.on('data', c => (s += c))
  req.on('end', () => { try { res(s ? JSON.parse(s) : {}) } catch { res(Object.fromEntries(new URLSearchParams(s))) } })
})

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,HEAD,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
}
const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const one = (req, rows) => ((req.headers.accept ?? '').includes('vnd.pgrst.object') ? rows[0] ?? null : rows)

async function api(req, res, url) {
  const uid = sessions.get((req.headers.authorization ?? '').replace(/^Bearer /, '')) ?? null
  const path = url.pathname

  // Auth: any address, code 123456.
  if (path === '/auth/v1/otp') return send(res, 200, {})
  if (path === '/auth/v1/verify') {
    const b = await read(req)
    if (b.token !== CODE) return send(res, 403, { code: 'otp_expired', error_code: 'otp_expired', msg: 'Token has expired or is invalid' })
    return send(res, 200, sessionFor(userFor(b.email)))
  }
  if (path === '/auth/v1/token') {
    const b = await read(req)
    const id = sessions.get(String(b.refresh_token ?? '').replace(/^refresh-/, ''))
    return id ? send(res, 200, sessionFor(profile(id))) : send(res, 400, { error: 'invalid_grant' })
  }
  if (path === '/auth/v1/user') return uid ? send(res, 200, sessionFor(profile(uid)).user) : send(res, 401, { msg: 'not signed in' })
  if (path === '/auth/v1/logout') return send(res, 204)
  if (path.startsWith('/auth/')) return send(res, 200, {})

  // Matchtipset's functions, and quiet answers for the rest of the app.
  const fn = path.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1]
  if (fn) {
    const args = await read(req)
    if (!rpc[fn]) return send(res, 200, fn === 'post_stats' ? [] : null)
    if (!uid) return send(res, 401, { code: '42501', message: 'sign in to use Matchtipset', details: null, hint: null })
    try { return send(res, 200, rpc[fn](uid, args)) }
    catch (e) { return send(res, e.status ?? 400, { code: e.code, message: e.message, details: null, hint: null }) }
  }
  if (path === '/rest/v1/profiles') {
    if (req.method === 'PATCH' && uid) Object.assign(profile(uid), await read(req))
    const id = url.searchParams.get('id')?.replace(/^eq\./, '')
    const rows = state.profiles.filter(p => !id || p.id === id).map(({ email, ...p }) => p)
    return send(res, 200, one(req, rows))
  }
  if (req.method === 'HEAD') return send(res, 200, undefined, { 'Content-Range': '*/0' })
  return send(res, 200, one(req, []), { 'Content-Range': '*/0' })
}

/* ── The operator panel (what the owner does in the SQL editor) ───────── */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const when = t => (t === null ? '–' : new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }))

function panel(message = '') {
  const rows = state.matches.map((m) => {
    const subs = state.submissions.filter(s => s.match === m.id).sort((a, b) => a.at - b.at)
    const phase = m.status === 'void' ? 'struken' : m.locks_at === null ? 'pausad' : locked(m) ? (m.result ? 'klar' : 'låst – väntar på resultat') : 'öppen'
    return `<section><h2>${esc(m.home_team)} – ${esc(m.away_team)} <small>(${phase})</small></h2>
      <p>Start ${when(m.scheduled_start)} · deadline ${when(m.locks_at)}${m.result ? ` · resultat efter 60: <b>${m.result.home}–${m.result.away}</b> (${m.result.decided_in}, revision ${m.result_revision})` : ''}</p>
      <form method="post" action="/panel/lock"><input type="hidden" name="match" value="${m.id}"><button ${locked(m) ? 'disabled' : ''}>Låt deadlinen passera nu</button></form>
      <form method="post" action="/panel/result"><input type="hidden" name="match" value="${m.id}">
        Verifierat resultat efter 60 min: <input name="home" size="2" value="${m.result?.home ?? ''}" required> – <input name="away" size="2" value="${m.result?.away ?? ''}" required>
        <select name="decided_in"><option value="regulation">avgjord efter 60</option><option value="overtime">förlängning</option><option value="shootout">straffar</option></select>
        <button ${locked(m) ? '' : 'disabled'}>${m.result ? 'Rätta resultatet' : 'Registrera resultat'}</button></form>
      <details><summary>Operatörsvy: alla inlämnade tips (${subs.length}) – syns aldrig för supportrar</summary><ul>${subs.map(s => `<li>@${esc(profile(s.profile)?.handle)} rev ${s.revision}: ${s.home}–${s.away} · ${when(s.at)}${m.locks_at !== null && s.at >= m.locks_at ? ' (efter deadline)' : ''}</li>`).join('') || '<li>Inga</li>'}</ul></details>
    </section>`
  }).join('')
  return `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Matchtipset – lokal förhandsvisning (operatör)</title>
  <style>body{font:15px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;background:#061229;color:#f3eee3}a{color:#5fb0ec}
  .banner{background:#f4c430;color:#061229;padding:.75rem 1rem;border-radius:.75rem;font-weight:700}section{border:1px solid #ffffff22;border-radius:1rem;padding:1rem;margin:1rem 0}
  form{margin:.5rem 0}button{font:inherit;padding:.35rem .9rem;border-radius:999px;border:0;background:#5fb0ec;color:#061229;font-weight:700;cursor:pointer}button[disabled]{opacity:.4;cursor:default}
  input,select{font:inherit;width:auto}.msg{color:#f4c430}small{color:#b9bfcc;font-weight:400}</style>
  <p class="banner">LOKAL FÖRHANDSVISNING – TESTDATA. Inget här når den riktiga databasen (djurgarn-dev). Allt försvinner när skriptet stoppas.</p>
  <h1>Operatörspanel</h1>
  <p>Appen: <a href="http://localhost:${APP_PORT}/matchtipset" target="_blank">http://localhost:${APP_PORT}/matchtipset</a> · Logga in med valfri e-post och koden <b>${CODE}</b>. Ladda om Matchtipset-fliken efter en åtgärd här.</p>
  ${message ? `<p class="msg">${esc(message)}</p>` : ''}
  ${rows}
  <form method="post" action="/panel/reset"><button>Återställ all testdata</button></form>
  <h2>Logg</h2><ul>${state.log.slice().reverse().map(l => `<li>${when(l.at)} – ${esc(l.text)}</li>`).join('')}</ul></html>`
}

async function panelAction(req, res, url) {
  const b = await read(req)
  const m = state.matches.find(x => x.id === b.match)
  let message = ''
  if (url.pathname === '/panel/reset') {
    // Fresh fixtures; profiles made by signing in stay (their sessions do too), but nobody takes part any more.
    const signedUp = state.profiles.filter(p => !p.handle.startsWith('test_'))
    seed()
    state.profiles.push(...signedUp)
    message = 'All testdata återställd. Inloggade testkonton finns kvar men är inte med i Matchtipset.'
  }
  else if (!m) message = 'Ingen sådan match.'
  else if (url.pathname === '/panel/lock') {
    if (locked(m)) message = 'Deadlinen har redan passerat.'
    else {
      m.locks_at = m.scheduled_start = now() - 1000
      state.log.push({ at: now(), text: `Deadline passerad: ${m.home_team} – ${m.away_team}. Tipsen är nu låsta och synliga.` })
      message = 'Deadlinen har passerat. Ladda om appen: tipsen är låsta och allas tips syns.'
    }
  }
  else if (url.pathname === '/panel/result') {
    const h = Number(b.home), a = Number(b.away), d = b.decided_in
    const whole = n => Number.isInteger(n) && n >= 0 && n <= 30
    if (!locked(m)) message = 'Resultat kan bara registreras efter deadline.'
    else if (!whole(h) || !whole(a)) message = 'Mål måste vara heltal 0–30.'
    else if (d === 'regulation' && h === a) message = 'Avgjord efter 60 kan inte vara oavgjord (samma regel som databasen).'
    else if (d !== 'regulation' && h !== a) message = 'Förlängning eller straffar kräver oavgjort efter 60 (samma regel som databasen).'
    else {
      m.result = { home: h, away: a, decided_in: d }
      m.result_revision++
      m.result_note = m.result_revision > 1 ? `TESTDATA: rättat till ${h}–${a}` : `TESTDATA: ${h}–${a} efter 60`
      state.log.push({ at: now(), text: `Resultat ${m.result_revision > 1 ? 'rättat' : 'registrerat'}: ${m.home_team} – ${m.away_team} ${h}–${a} (${d}).` })
      message = 'Resultatet är registrerat. Ladda om appen: poäng och tabell är uppdaterade.'
    }
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(panel(message))
}

createServer(async (req, res) => {
  const url = new URL(req.url, MOCK_URL)
  cors(req, res)
  if (req.method === 'OPTIONS') return send(res, 204)
  try {
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(panel())
    }
    if (url.pathname.startsWith('/panel/') && req.method === 'POST') return await panelAction(req, res, url)
    return await api(req, res, url)
  }
  catch (e) {
    send(res, 500, { message: String(e) })
  }
}).listen(MOCK_PORT, '127.0.0.1', () => {
  // The real app, built, pointed only at this mock. It never reads .env (that's a dev-server thing).
  const env = { ...process.env, PORT: String(APP_PORT), HOST: 'localhost', NUXT_PUBLIC_SUPABASE_URL: MOCK_URL, NUXT_PUBLIC_SUPABASE_KEY: 'sb_publishable_local_preview' }
  const app = spawn(process.execPath, ['.output/server/index.mjs'], { env, stdio: ['ignore', 'inherit', 'inherit'] })
  process.on('SIGINT', () => { app.kill(); process.exit(0) })
  console.log(`
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Matchtipset – LOKAL FÖRHANDSVISNING med TESTDATA (inget når hosted) │
  └──────────────────────────────────────────────────────────────────────┘
  App:               http://localhost:${APP_PORT}/matchtipset
  Operatörspanel:    ${MOCK_URL}/
  Logga in:          valfri e-post, koden ${CODE}
  Stoppa:            Ctrl+C (all testdata försvinner)
`)
})
