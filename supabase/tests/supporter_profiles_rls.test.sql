-- Authorization tests for supporter profiles (bio, avatar, team interests),
-- against a real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end. Existing supporters, posts
-- and preferences are never read or changed: every check is scoped to the
-- two test users.
--
-- Mirrors tests/supporter-profiles-db.test.ts, which runs the same checks locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'lotta@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'hasse@example.test');

-- ── Structure ────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.profile_preferences'::regclass), 'RLS is enabled on profile_preferences');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'profile_preferences' and grantee in ('anon', 'public')),
  0, 'anon and public have no privileges on preferences');
select is(
  (select count(*)::int from information_schema.column_privileges where table_schema = 'public' and table_name = 'profile_preferences' and grantee = 'authenticated' and column_name = 'profile_id' and privilege_type in ('INSERT', 'UPDATE')),
  0, 'supporters can never write profile_id');
select ok(not has_function_privilege('anon', 'public.save_team_interests(text[])', 'execute'), 'anon cannot save team interests');

-- ── Lotta and Hasse create profiles; Lotta sets her bio and avatar ───────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select lives_ok($$ insert into public.profiles (id, display_name, handle) values ('22222222-2222-4222-8222-222222222222', 'Hovet-Hasse', 'rlstest_hasse') $$, 'Hasse creates his profile');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok($$ insert into public.profiles (id, display_name, handle, bio, avatar) values ('11111111-1111-4111-8111-111111111111', 'Lotta från Gärdet', 'rlstest_lotta', 'Sektion A sedan 1998.', 'halsduk') $$, 'Lotta creates her profile with a bio and an avatar');
select results_eq($$ update public.profiles set bio = 'Järnkaminer och kaffe.' where id = '11111111-1111-4111-8111-111111111111' returning bio $$, array['Järnkaminer och kaffe.'], 'Lotta can change her bio');
select throws_ok($$ update public.profiles set bio = repeat('x', 161) where id = '11111111-1111-4111-8111-111111111111' $$, '23514', null, 'A bio is at most 160 characters');
select throws_ok($$ update public.profiles set bio = E'Rad ett\nrad två' where id = '11111111-1111-4111-8111-111111111111' $$, '23514', null, 'A bio is one paragraph');
select throws_ok($$ update public.profiles set avatar = 'dif-logga' where id = '11111111-1111-4111-8111-111111111111' $$, '23514', null, 'Only known avatar designs');
select is_empty($$ update public.profiles set bio = 'Hackad' where id = '22222222-2222-4222-8222-222222222222' returning id $$, 'Lotta cannot change Hasse''s bio');

-- ── Before posting, Lotta's bio is hers alone ────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty($$ select bio from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$, 'Anon cannot read the bio of a supporter who has not posted');

reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok($$ select public.publish_post('rlstest: Lotta kliver fram') $$, 'Lotta publishes a post');

-- ── After posting, bio and avatar are public, timestamps are not ─────────
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq($$ select bio || ' / ' || avatar from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$, array['Järnkaminer och kaffe. / halsduk'], 'Anon reads her bio and avatar once she has posted');
select throws_ok($$ select created_at from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$, '42501', null, 'Anon still cannot read profile timestamps');
select throws_ok($$ select teams from public.profile_preferences $$, '42501', null, 'Anon cannot read preferences');

-- ── Team interests ───────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select results_eq($$ select array_to_string(teams, ',') from public.save_team_interests(array['hockey:dam', 'fotboll:herr', 'hockey:dam']) $$, array['fotboll:herr,hockey:dam'], 'Lotta saves her teams, sorted and without repeats');
select results_eq($$ select cardinality(teams) from public.save_team_interests(array[]::text[]) $$, array['0'], 'No teams is a valid choice');
select throws_ok($$ select public.save_team_interests(array['bandy:herr']) $$, '23514', null, 'Only the four teams');
select lives_ok($$ select public.save_team_interests(array['fotboll:dam']) $$, 'Lotta follows fotboll:dam');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is_empty($$ select teams from public.profile_preferences where profile_id = '11111111-1111-4111-8111-111111111111' $$, 'Hasse cannot read Lotta''s teams');
select is_empty($$ update public.profile_preferences set teams = '{hockey:herr}' where profile_id = '11111111-1111-4111-8111-111111111111' returning profile_id $$, 'Hasse cannot change Lotta''s teams');
select throws_ok($$ insert into public.profile_preferences (profile_id, teams) values ('11111111-1111-4111-8111-111111111111', '{hockey:herr}') $$, '42501', null, 'Hasse cannot write teams for Lotta');

-- ── Lotta's choice is intact ─────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
select results_eq($$ select array_to_string(teams, ',') from public.profile_preferences where profile_id = '11111111-1111-4111-8111-111111111111' $$, array['fotboll:dam'], 'Lotta''s teams were never changed by Hasse');

select * from finish();
rollback;
