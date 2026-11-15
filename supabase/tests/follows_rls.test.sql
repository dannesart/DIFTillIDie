-- Authorization tests for public.supporter_follows, follow_supporter(),
-- unfollow_supporter() and followed_supporters() (#9), against a real
-- Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end: test users, profiles, posts
-- and follows are never committed. Don't run against production.
--
-- Safe on a database that already has real supporters and follows: every
-- assertion is scoped to this suite's own users.
--
-- Users: Järnis and Lotta are public (they have posted), Mattias has a
-- profile but has never posted (private), Nils is signed in without a profile.
-- Mirrors tests/follows-db.test.ts, which runs locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('81818181-8181-4181-8181-818181818181', 'rlstest-f-jarnis@example.test'),
  ('82828282-8282-4282-8282-828282828282', 'rlstest-f-mattias@example.test'),
  ('83838383-8383-4383-8383-838383838383', 'rlstest-f-lotta@example.test'),
  ('84848484-8484-4484-8484-848484848484', 'rlstest-f-nils@example.test');
insert into public.profiles (id, display_name, handle) values
  ('81818181-8181-4181-8181-818181818181', 'Järnis', 'rlstest_f_jarnis'),
  ('82828282-8282-4282-8282-828282828282', 'Mattias', 'rlstest_f_mattias'),
  ('83838383-8383-4383-8383-838383838383', 'Lotta', 'rlstest_f_lotta');
insert into public.posts (author_id, body) values
  ('81818181-8181-4181-8181-818181818181', 'Testinlägg för följ'),
  ('83838383-8383-4383-8383-838383838383', 'Testinlägg för följ');

-- ── Structure ────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.supporter_follows'::regclass), 'RLS is enabled on supporter_follows');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'supporter_follows' and grantee in ('anon', 'public')),
  0, 'anon has no access to follows at all');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges where table_schema = 'public' and table_name = 'supporter_follows' and grantee = 'authenticated' and privilege_type = 'INSERT'),
  array['followed_id'], 'authenticated may only write followed_id (never follower_id)');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'supporter_follows' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  0, 'a follow is never updated, only added or removed');
select ok(not has_function_privilege('anon', 'public.follow_supporter(uuid)', 'execute'), 'anon may not follow');
select ok(not has_function_privilege('anon', 'public.followed_supporters()', 'execute'), 'anon may not list follows');

-- ── Mattias (a profile, never posted) follows Järnis (public) ───────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select lives_ok($$ select public.follow_supporter('81818181-8181-4181-8181-818181818181') $$, 'Mattias follows Järnis');
select lives_ok($$ select public.follow_supporter('81818181-8181-4181-8181-818181818181') $$, 'following again is harmless');
select results_eq($$ select followed_id::text from public.supporter_follows $$, array['81818181-8181-4181-8181-818181818181'], 'still exactly one follow');
select results_eq($$ select handle from public.followed_supporters() $$, array['rlstest_f_jarnis'], 'Mattias sees Järnis in his own list');
select throws_ok($$ select public.follow_supporter('82828282-8282-4282-8282-828282828282') $$, '23514', null, 'nobody follows themself');
reset role;

-- ── Lotta (public) tries to follow someone who isn't public ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
select throws_ok($$ select public.follow_supporter('82828282-8282-4282-8282-828282828282') $$, 'P0002', null, 'a private profile: "no public supporter"');
select throws_ok($$ select public.follow_supporter('89898989-8989-4989-8989-898989898989') $$, 'P0002', null, 'a missing account: the very same answer');
select throws_ok($$ insert into public.supporter_follows (followed_id) values ('82828282-8282-4282-8282-828282828282') $$, '42501', null, 'going round the function: refused too');
select throws_ok($$ insert into public.supporter_follows (follower_id, followed_id) values ('82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383') $$, '42501', null, 'nobody follows on someone else''s behalf');
select lives_ok($$ delete from public.supporter_follows $$, 'Lotta''s delete reaches only her own (none)');
reset role;

-- ── Nils (signed in, no profile) ────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"84848484-8484-4484-8484-848484848484","role":"authenticated"}', true);
select throws_ok($$ select public.follow_supporter('81818181-8181-4181-8181-818181818181') $$, '42501', null, 'no profile, no following');
reset role;

-- ── Järnis can't see who follows him ────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-4181-8181-818181818181","role":"authenticated"}', true);
select is_empty($$ select 1 from public.supporter_follows $$, 'the followed supporter reads none of it');
select is_empty($$ select 1 from public.followed_supporters() $$, 'and his own list is empty');
reset role;

-- ── Signed out ──────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select 1 from public.supporter_follows $$, '42501', null, 'anon reads no follows');
reset role;
select set_config('request.jwt.claims', '', true);

select results_eq($$ select follower_id::text || '>' || followed_id::text from public.supporter_follows where follower_id in ('81818181-8181-4181-8181-818181818181', '82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383') $$,
  array['82828282-8282-4282-8282-828282828282>81818181-8181-4181-8181-818181818181'], 'Mattias''s follow survived everyone else''s attempts');

-- ── Unfollow, and deletion ──────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select is((select public.unfollow_supporter('81818181-8181-4181-8181-818181818181')), true, 'Mattias unfollows Järnis');
select is((select public.unfollow_supporter('81818181-8181-4181-8181-818181818181')), false, 'unfollowing again is harmless');
select lives_ok($$ select public.follow_supporter('81818181-8181-4181-8181-818181818181') $$, 'and follows him again');
reset role;
select set_config('request.jwt.claims', '', true);

delete from auth.users where id = '81818181-8181-4181-8181-818181818181';
select is_empty($$ select 1 from public.supporter_follows where follower_id = '82828282-8282-4282-8282-828282828282' or followed_id = '81818181-8181-4181-8181-818181818181' $$, 'deleting an account deletes its follows');

select * from finish();
rollback;
