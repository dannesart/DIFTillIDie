-- Authorization tests for handle aliases (old /laktaren/<handle> links),
-- against a real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end. Every check is scoped to
-- the two test users; existing supporters are never read or changed.
--
-- Mirrors tests/handle-aliases-db.test.ts, which runs the same checks locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'lotta@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'hasse@example.test');

-- ── Structure ────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.profile_handle_aliases'::regclass), 'RLS is enabled on profile_handle_aliases');
select is(
  (select count(*)::int from information_schema.column_privileges where table_schema = 'public' and table_name = 'profile_handle_aliases' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'nobody may write aliases through the API');

-- ── Lotta and Hasse; Lotta changes her handle ────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select lives_ok($$ insert into public.profiles (id, display_name, handle) values ('22222222-2222-4222-8222-222222222222', 'Hasse', 'rlstest_hasse') $$, 'Hasse creates his profile');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok($$ insert into public.profiles (id, display_name, handle) values ('11111111-1111-4111-8111-111111111111', 'Lotta', 'rlstest_lotta') $$, 'Lotta creates her profile');
select lives_ok($$ update public.profiles set handle = 'rlstest_lotta2' where id = '11111111-1111-4111-8111-111111111111' $$, 'Lotta changes her handle');
select results_eq($$ select profile_id::text from public.profile_handle_aliases where handle = 'rlstest_lotta' $$, array['11111111-1111-4111-8111-111111111111'], 'Lotta can resolve her old handle');
select throws_ok($$ insert into public.profile_handle_aliases (handle, profile_id) values ('rlstest_fake', '11111111-1111-4111-8111-111111111111') $$, '42501', null, 'Lotta cannot write aliases herself');

-- ── Before she posts, her alias is hers alone ────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is_empty($$ select profile_id from public.profile_handle_aliases where handle = 'rlstest_lotta' $$, 'Hasse cannot resolve the alias of an unpublished profile');
select throws_ok($$ update public.profiles set handle = 'rlstest_lotta' where id = '22222222-2222-4222-8222-222222222222' $$, '23505', null, 'Hasse cannot take Lotta''s retired handle');
select throws_ok($$ delete from public.profile_handle_aliases where handle = 'rlstest_lotta' $$, '42501', null, 'Hasse cannot delete Lotta''s alias');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty($$ select profile_id from public.profile_handle_aliases where handle = 'rlstest_lotta' $$, 'Anon cannot resolve the alias of an unpublished profile');

-- ── After she posts, it resolves for everyone ────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok($$ select public.publish_post('rlstest: Lotta kliver fram') $$, 'Lotta publishes a post');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq($$ select profile_id::text from public.profile_handle_aliases where handle = 'rlstest_lotta' $$, array['11111111-1111-4111-8111-111111111111'], 'Anon resolves her old handle once she has posted');
select throws_ok($$ select retired_at from public.profile_handle_aliases $$, '42501', null, 'Anon cannot read when a handle was retired');

select * from finish();
rollback;
