-- Authorization tests for public.profiles, against a real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end: the two test users and
-- their profiles are never committed. Don't run against production.
--
-- Mirrors tests/profiles-db.test.ts, which runs the same checks locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'lotta@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'hasse@example.test');

-- ── Structure ────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS is enabled on profiles');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'public')),
  0, 'anon and public have no table privileges');
select is(
  (select array_agg(privilege_type::text order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated'),
  array['SELECT'], 'authenticated has only SELECT at table level (INSERT/UPDATE are column-level)');

-- ── Anonymous ────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ insert into public.profiles (id, display_name, handle) values ('11111111-1111-4111-8111-111111111111', 'Anon', 'anon_user') $$, '42501', null, 'anon cannot create profiles');
select throws_ok($$ update public.profiles set display_name = 'Hackad' $$, '42501', null, 'anon cannot update profiles');
select throws_ok($$ delete from public.profiles $$, '42501', null, 'anon cannot delete profiles');

-- ── Hasse creates his profile ────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select lives_ok($$ insert into public.profiles (id, display_name, handle) values ('22222222-2222-4222-8222-222222222222', 'Hovet-Hasse', 'hovethasse') $$, 'Hasse can create his own profile');

-- ── Lotta: own profile ───────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok($$ insert into public.profiles (id, display_name, handle) values ('11111111-1111-4111-8111-111111111111', 'Lotta från Gärdet', 'kaminen81') $$, 'Lotta can create her own profile');
select results_eq($$ select handle from public.profiles $$, array['kaminen81'], 'Lotta sees only her own profile');
select results_eq($$ update public.profiles set display_name = 'Lotta' where id = '11111111-1111-4111-8111-111111111111' returning display_name $$, array['Lotta'], 'Lotta can update her own profile');
select throws_ok($$ update public.profiles set id = '22222222-2222-4222-8222-222222222222' $$, '42501', null, 'Lotta cannot change her id');
select throws_ok($$ update public.profiles set created_at = now() - interval '10 years' $$, '42501', null, 'Lotta cannot rewrite created_at');
select throws_ok($$ delete from public.profiles $$, '42501', null, 'Lotta cannot delete profiles');

-- ── Lotta vs Hasse's profile ─────────────────────────────────────────────
select is_empty($$ select * from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$, 'Lotta cannot read Hasse''s profile');
select is_empty($$ update public.profiles set display_name = 'Hackad' where id = '22222222-2222-4222-8222-222222222222' returning id $$, 'Lotta cannot update Hasse''s profile');
select results_eq($$ update public.profiles set display_name = 'Lotta G' returning id::text $$, array['11111111-1111-4111-8111-111111111111'], 'An UPDATE without WHERE touches only Lotta''s row');
select throws_ok($$ insert into public.profiles (id, display_name, handle) values ('22222222-2222-4222-8222-222222222222', 'Fake Hasse', 'fake_hasse') $$, '42501', null, 'Lotta cannot create a profile for Hasse');

-- ── Rules ────────────────────────────────────────────────────────────────
select throws_ok($$ update public.profiles set handle = 'hovethasse' where id = '11111111-1111-4111-8111-111111111111' $$, '23505', null, 'Handles are unique');
select throws_ok($$ update public.profiles set handle = 'Kaminen81' where id = '11111111-1111-4111-8111-111111111111' $$, '23514', null, 'Handles must be lowercase');
select throws_ok($$ update public.profiles set handle = 'dif' where id = '11111111-1111-4111-8111-111111111111' $$, '23514', null, 'Reserved handles are rejected');

-- ── Hasse's profile is untouched ─────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
select results_eq($$ select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$, array['Hovet-Hasse'], 'Hasse''s profile was never changed');

select * from finish();
rollback;
