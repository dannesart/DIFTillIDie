-- Authorization tests for public.posts (and the public author names it
-- exposes on public.profiles), against a real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end: the test users, their
-- profiles and posts are never committed. Don't run against production.
--
-- Users: Hasse (profile, posts), Lotta (profile, never posts), Nils (signed
-- in, no profile). Mirrors tests/posts-db.test.ts, which runs locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'lotta@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'hasse@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'nils@example.test');

-- ── Structure ────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.posts'::regclass), 'RLS is enabled on posts');
select is(
  (select array_agg(privilege_type::text order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'posts' and grantee = 'anon'),
  array['SELECT'], 'anon may only read posts');
select is(
  (select array_agg(privilege_type::text order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'posts' and grantee = 'authenticated'),
  array['DELETE', 'SELECT'], 'authenticated may read and delete at table level (INSERT is column-level, no UPDATE)');
select is(
  (select count(*)::int from information_schema.column_privileges where table_schema = 'public' and table_name = 'posts' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')),
  0, 'no column of posts can be written directly: publishing goes through publish_post()');
select ok(not has_function_privilege('anon', 'public.publish_post(text, text, text, text)', 'execute'), 'anon cannot execute publish_post');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles' and grantee = 'anon' and privilege_type = 'SELECT'),
  -- bio and avatar since 20261105220958_supporter_profiles; never timestamps.
  array['avatar', 'bio', 'display_name', 'handle', 'id'], 'anon may read only the public profile columns');

-- ── Profiles for Hasse and Lotta, made by themselves ─────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('22222222-2222-4222-8222-222222222222', 'Hovet-Hasse', 'rlstest_hasse');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('11111111-1111-4111-8111-111111111111', 'Lotta från Gärdet', 'rlstest_lotta');
reset role;

-- ── Anonymous, before anyone has posted ──────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select lives_ok($$ select id, body from public.posts $$, 'anon can read posts');
select is_empty($$ select id from public.profiles where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222') $$, 'anon sees neither test profile while neither has posted');
select throws_ok($$ select created_at from public.profiles $$, '42501', null, 'anon can never read profile timestamps');
select throws_ok($$ insert into public.posts (body) values ('Anonymt') $$, '42501', null, 'anon cannot insert a post');
select throws_ok($$ select public.publish_post('Anonymt') $$, '42501', null, 'anon cannot publish');
select throws_ok($$ delete from public.posts $$, '42501', null, 'anon cannot delete posts');
select throws_ok($$ update public.posts set body = 'x' $$, '42501', null, 'anon cannot edit posts');

-- ── Nils: signed in, no profile ──────────────────────────────────────────
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select throws_ok($$ select public.publish_post('Utan profil') $$, '42501', null, 'a supporter without a profile cannot publish');

-- ── Hasse publishes ──────────────────────────────────────────────────────
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select lives_ok($$ select public.publish_post('Järnkaminen brinner! #hovet', 'hockey') $$, 'Hasse can publish');
-- now() is this transaction's start time, so created_at = now() picks out only rows this suite made.
select results_eq($$ select author_id::text from public.posts where created_at = now() $$, array['22222222-2222-4222-8222-222222222222'], 'the database sets Hasse as the author');
select throws_ok($$ insert into public.posts (body, author_id) values ('Jag är Lotta', '11111111-1111-4111-8111-111111111111') $$, '42501', null, 'Hasse cannot choose another author');
select throws_ok($$ insert into public.posts (body, author_id) values ('Jag är jag', '22222222-2222-4222-8222-222222222222') $$, '42501', null, 'author_id cannot be supplied at all, not even your own');
select throws_ok($$ insert into public.posts (body, created_at) values ('Backdaterat', now() - interval '1 year') $$, '42501', null, 'Hasse cannot choose the timestamp');
select throws_ok($$ update public.posts set body = 'Ändrat' $$, '42501', null, 'posts cannot be edited, not even by the author');

-- ── Rules ────────────────────────────────────────────────────────────────
select throws_ok($$ select public.publish_post('') $$, '23514', null, 'an empty post is rejected');
select throws_ok($$ select public.publish_post('   ') $$, '23514', null, 'a whitespace-only post is rejected');
select throws_ok($$ select public.publish_post(repeat('x', 281)) $$, '23514', null, 'more than 280 characters is rejected');
select throws_ok($$ select public.publish_post('Bandy!', 'bandy') $$, '23514', null, 'an unknown sport is rejected');
select throws_ok($$ select public.publish_post(E'Dold\x07klocka') $$, '23514', null, 'control characters are rejected');

-- ── Lotta: reads Hasse's post, can't touch it ────────────────────────────
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select results_eq($$ select pr.handle from public.posts p join public.profiles pr on pr.id = p.author_id where p.author_id = '22222222-2222-4222-8222-222222222222' $$, array['rlstest_hasse'], 'Lotta sees Hasse''s post with his public handle');
select is_empty($$ delete from public.posts where author_id = '22222222-2222-4222-8222-222222222222' returning id $$, 'Lotta cannot delete Hasse''s post');
-- Safe on a non-empty database: RLS limits it to Lotta's own posts (she has none), and the whole suite is rolled back.
select is_empty($$ delete from public.posts returning id $$, 'a DELETE without WHERE removes nothing of anyone else''s');

-- ── Anonymous, after Hasse posted ────────────────────────────────────────
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq($$ select pr.display_name from public.posts p join public.profiles pr on pr.id = p.author_id where p.author_id = '22222222-2222-4222-8222-222222222222' $$, array['Hovet-Hasse'], 'anon sees Hasse''s post with his display name');
select is_empty($$ select id from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$, 'a supporter who never posted stays private');

-- ── Hasse deletes his own post ───────────────────────────────────────────
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
-- RLS limits this to Hasse's own posts, i.e. the one this suite made.
select results_eq($$ delete from public.posts returning body $$, array['Järnkaminen brinner! #hovet'], 'Hasse can delete his own post');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty($$ select id from public.posts where author_id = '22222222-2222-4222-8222-222222222222' $$, 'the deleted post is gone for everyone');
select is_empty($$ select id from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$, 'with no posts left, Hasse''s profile is private again');

-- ── Accounts and profiles are untouched ──────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
select results_eq($$ select handle from public.profiles where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222') order by handle $$, array['rlstest_hasse', 'rlstest_lotta'], 'both test profiles still exist, unchanged');

select * from finish();
rollback;
