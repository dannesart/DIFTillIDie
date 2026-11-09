-- Security tests for Matchtipset (20261109160000_matchtipset_foundation.sql)
-- against a real Supabase database: grants, exposure, opt-in/out, secrecy
-- before the deadline, the corrected-deadline rule, results, the operations
-- log and account deletion.
--
-- Run with the Supabase CLI (`supabase test db`) against the LOCAL stack, as
-- CI does (.github/workflows/database.yml). Everything happens in one
-- transaction that is ROLLED BACK at the end, but it still creates test
-- users, a test match and predictions while it runs: NEVER run it against
-- the hosted project. (Production gets read-only checks only; see
-- docs/matchtipset.md.)
--
-- Users: Ada and Bo take part, Cia has a profile but doesn't, Dan is signed
-- in without a profile. Mirrors tests/matchtipset-db.test.ts, which runs locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

insert into auth.users (id, email) values
  ('81818181-8181-4181-8181-818181818181', 'rlstest-ada@example.test'),
  ('82828282-8282-4282-8282-828282828282', 'rlstest-bo@example.test'),
  ('83838383-8383-4383-8383-838383838383', 'rlstest-cia@example.test'),
  ('84848484-8484-4484-8484-848484848484', 'rlstest-dan@example.test');

-- ── Structure: nothing reachable except the supporter functions ──────────
select ok(not has_schema_privilege('anon', 'matchtips', 'usage'), 'anon cannot use the matchtips schema');
select ok(not has_schema_privilege('authenticated', 'matchtips', 'usage'), 'authenticated cannot use the matchtips schema');
select ok(not has_schema_privilege('service_role', 'matchtips', 'usage'), 'service_role cannot use the matchtips schema');
select ok(not has_schema_privilege('anon', 'matchtips_ops', 'usage'), 'anon cannot use matchtips_ops');
select ok(not has_schema_privilege('authenticated', 'matchtips_ops', 'usage'), 'authenticated cannot use matchtips_ops');
select ok(not has_schema_privilege('service_role', 'matchtips_ops', 'usage'), 'service_role cannot use matchtips_ops');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema in ('matchtips', 'matchtips_ops') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0, 'no API role has any table grant in the matchtips schemas');
select is(
  (select count(*)::int from pg_class where relnamespace = 'matchtips'::regnamespace and relkind = 'r' and relrowsecurity),
  4, 'RLS is enabled on all four matchtips tables');
select is(
  (select count(*)::int from pg_proc where pronamespace = 'matchtips_ops'::regnamespace
     and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('service_role', oid, 'execute'))),
  0, 'no API role can execute an ops function');
select is(
  (select count(*)::int from pg_proc where proname like 'matchtips\_%' and pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  0, 'anon cannot execute any supporter function');
select is(
  (select count(*)::int from pg_proc where proname like 'matchtips\_%' and pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', oid, 'execute')),
  9, 'authenticated can execute exactly the nine supporter functions');
select is(
  (select count(*)::int from pg_proc where proname like 'matchtips\_%' and pronamespace = 'public'::regnamespace and prosecdef and coalesce(proconfig, '{}') <> array['search_path=""']),
  0, 'every security definer supporter function pins search_path to empty');

-- ── Profiles; Ada and Bo join ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-4181-8181-818181818181","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('81818181-8181-4181-8181-818181818181', 'Ada', 'rlstest_ada');
select lives_ok($$ select public.matchtips_join(public.matchtips_consent_version()) $$, 'Ada joins with the current consent version');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('82828282-8282-4282-8282-828282828282', 'Bo', 'rlstest_bo');
select throws_ok($$ select public.matchtips_join('an-old-version') $$, '22023', null, 'Bo cannot join with another consent version');
select lives_ok($$ select public.matchtips_join(public.matchtips_consent_version()) $$, 'Bo joins');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('83838383-8383-4383-8383-838383838383', 'Cia', 'rlstest_cia');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"84848484-8484-4484-8484-848484848484","role":"authenticated"}', true);
select throws_ok($$ select public.matchtips_join(public.matchtips_consent_version()) $$, '42501', null, 'Dan (no profile) cannot join');
reset role;

-- ── An open match, entered by the owner ──────────────────────────────────
select set_config('rlstest.open', matchtips_ops.create_match(
  '2026/27', 'Djurgården', 'Rlstest IK', now() + interval '1 day',
  'https://www.difhockey.se/game-schedule', null, 'pgTAP: öppen testmatch', 'rlstest')::text, true);

select is(
  (select operator_declared || '/' || db_role from matchtips.match_log where match_id = current_setting('rlstest.open')::uuid),
  'rlstest/' || current_user, 'creating a match is logged with the declared operator and the database role');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-4181-8181-818181818181","role":"authenticated"}', true);
select is((select revision from public.matchtips_submit(current_setting('rlstest.open')::uuid, 2, 1)), 1, 'Ada predicts 2–1: revision 1');
select is((select revision from public.matchtips_submit(current_setting('rlstest.open')::uuid, 3, 1)), 2, 'Ada changes to 3–1: revision 2');
select throws_ok($$ select public.matchtips_submit(current_setting('rlstest.open')::uuid, 31, 0) $$, '22023', null, 'goals above 30 are refused');
select throws_ok($$ select * from matchtips.prediction_submissions $$, '42501', null, 'Ada cannot read the submissions table');
select throws_ok($$ insert into matchtips.prediction_submissions (match_id, profile_id, revision, home_goals, away_goals, submitted_at) values (current_setting('rlstest.open')::uuid, '82828282-8282-4282-8282-828282828282', 1, 9, 0, now()) $$, '42501', null, 'Ada cannot insert a submission, for herself or anyone');
select throws_ok($$ update matchtips.matches set result_home_60 = 9 $$, '42501', null, 'Ada cannot touch matches');
select throws_ok($$ select matchtips_ops.void_match(current_setting('rlstest.open')::uuid, 'https://example.test/x', 'nope', 'ada') $$, '42501', null, 'Ada cannot run an owner operation');
select results_eq($$ select (pick_home || '-' || pick_away || '/' || latest_counts) from public.matchtips_my_picks('2026/27') $$, array['3-1/true'], 'Ada sees her own current pick');
reset role;

-- ── Before the deadline, nobody else sees anything ───────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select is_empty($$ select * from public.matchtips_picks(current_setting('rlstest.open')::uuid) $$, 'Bo sees no picks for the open match');
select is_empty($$ select * from public.matchtips_my_picks('2026/27') $$, 'Bo''s own picks do not include Ada''s');
select is(
  (select sum(matches_tipped)::int from public.matchtips_leaderboard('2026/27') where handle like 'rlstest\_%'),
  0, 'the leaderboard counts nothing for an open match');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
select throws_ok($$ select public.matchtips_submit(current_setting('rlstest.open')::uuid, 1, 1) $$, '42501', null, 'Cia (not joined) cannot predict');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.matchtips_picks(current_setting('rlstest.open')::uuid) $$, '42501', null, 'anon cannot read picks');
select throws_ok($$ select * from public.matchtips_leaderboard('2026/27') $$, '42501', null, 'anon cannot read the leaderboard');
reset role;

-- ── A locked match whose published deadline was wrong (fixture) ──────────
-- Published 19:00 (an hour ago); it really started 18:00. Ada: 2–1 at 17:30,
-- 3–1 at 18:20. Bo: 1–1 at 18:20 only.
select set_config('matchtips.via_ops', 'on', true);
insert into matchtips.matches (id, season, home_team, away_team, scheduled_start, locks_at, official_url)
values ('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '2026/27', 'Rlstest HC', 'Djurgården', now() - interval '60 minutes', now() - interval '60 minutes', 'https://www.shl.se/rlstest');
select set_config('matchtips.via_ops', 'off', true);
insert into matchtips.prediction_submissions (match_id, profile_id, revision, home_goals, away_goals, submitted_at) values
  ('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '81818181-8181-4181-8181-818181818181', 1, 2, 1, now() - interval '150 minutes'),
  ('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '81818181-8181-4181-8181-818181818181', 2, 3, 1, now() - interval '100 minutes'),
  ('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '82828282-8282-4282-8282-828282828282', 1, 1, 1, now() - interval '100 minutes');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
select results_eq($$ select handle || ' ' || pick_home || '-' || pick_away from public.matchtips_picks('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a') $$,
  array['rlstest_ada 3-1', 'rlstest_bo 1-1'], 'after the published deadline Cia sees the effective picks');
reset role;

select throws_ok($$ select matchtips_ops.correct_deadline('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', now() + interval '1 hour', 'https://www.shl.se/rlstest', 'Senare', 'rlstest') $$,
  '22023', null, 'a correction cannot move the deadline later');
select throws_ok($$ update matchtips.matches set locks_at = now() + interval '1 hour', scheduled_start = now() + interval '1 hour' where id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a' $$,
  '42501', null, 'not even the owner can reopen a locked match with a direct update');
select lives_ok($$ select matchtips_ops.correct_deadline('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', now() - interval '120 minutes', 'https://www.shl.se/rlstest', 'Startade 18:00 enligt shl.se', 'rlstest') $$,
  'the owner corrects the deadline to the evidenced earlier start');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
select results_eq($$ select handle || ' ' || pick_home || '-' || pick_away from public.matchtips_picks('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a') $$,
  array['rlstest_ada 2-1'], 'after the correction: Ada''s earlier 2–1 counts again, Bo''s late pick is gone from the list');
select is(
  (select deadline_corrected from public.matchtips_matches('2026/27') where id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a'),
  true, 'the match is marked as having a corrected deadline');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-4181-8181-818181818181","role":"authenticated"}', true);
select results_eq($$ select pick_home || '-' || pick_away || ' latest ' || latest_home || '-' || latest_away || ' ' || latest_counts from public.matchtips_my_picks('2026/27') where match_id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a' $$,
  array['2-1 latest 3-1 false'], 'only Ada sees that her 3–1 does not count');
reset role;
select is(
  (select count(*)::int from matchtips.prediction_submissions where match_id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a'),
  3, 'the correction deleted or rewrote nothing');

-- ── Results and the leaderboard ──────────────────────────────────────────
select throws_ok($$ select matchtips_ops.record_result('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', 2, 2, 'regulation', 'https://www.shl.se/rlstest', 'Fel', 'rlstest') $$,
  '23514', null, 'a regulation result cannot be a draw after 60');
select lives_ok($$ select matchtips_ops.record_result('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', 3, 1, 'regulation', 'https://www.shl.se/rlstest', 'Matchrapport', 'rlstest') $$,
  'the owner records 3–1 after 60');
select lives_ok($$ select matchtips_ops.record_result('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', 2, 1, 'regulation', 'https://www.shl.se/rlstest', 'Rättad: 2–1', 'rlstest') $$,
  'and corrects it to 2–1');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select results_eq($$ select rank || ' ' || handle || ' ' || points || ' ' || matches_tipped from public.matchtips_leaderboard('2026/27') where handle like 'rlstest\_%' $$,
  array['1 rlstest_ada 3 1', '2 rlstest_bo 0 0'], 'the leaderboard follows the corrected result and the corrected deadline');
reset role;

select is(
  (select string_agg(action, ',' order by id) from matchtips.match_log where match_id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a'),
  'deadline_corrected,result,result', 'every operation on the match is in the log');
select throws_ok($$ delete from matchtips.match_log where match_id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a' $$, '42501', null, 'the log refuses deletes');
select throws_ok($$ update matchtips.prediction_submissions set home_goals = 9 $$, '42501', null, 'submissions refuse updates, even from the owner');

-- ── Leaving, and deleting an account ─────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select throws_ok($$ select public.matchtips_leave(false) $$, '22023', null, 'leaving must be confirmed');
select is(public.matchtips_leave(true), 1, 'Bo leaves: his one submission is removed');
reset role;
select is(
  (select count(*)::int from matchtips.prediction_submissions where profile_id = '82828282-8282-4282-8282-828282828282')
    + (select count(*)::int from matchtips.participants where profile_id = '82828282-8282-4282-8282-828282828282'),
  0, 'nothing of Bo''s Matchtipset data remains');

delete from auth.users where id = '81818181-8181-4181-8181-818181818181';
select is(
  (select count(*)::int from matchtips.prediction_submissions where profile_id = '81818181-8181-4181-8181-818181818181'),
  0, 'deleting Ada''s account deleted all her submissions');

select * from finish();
rollback;
