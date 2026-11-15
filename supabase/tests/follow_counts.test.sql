-- Authorization tests for public.supporter_follow_counts() (#9 v1.1, public
-- follow counts), against a real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end. Don't run against production.
--
-- Users (all scoped to this suite):
--   Järnis  public (has posted)
--   Mattias a profile, never posted or commented: private
--   Lotta   public (has posted)
--   Kim     public through a comment only
--   ghost   no account at all
-- Follows: Mattias→Järnis, Lotta→Järnis, Järnis→Lotta, Lotta→Kim, and
-- Järnis→Mattias (made while Mattias was public, say; he isn't now).
-- Mirrors tests/follow-counts-db.test.ts, which runs locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email) values
  ('91919191-9191-4191-8191-919191919191', 'rlstest-c-jarnis@example.test'),
  ('92929292-9292-4292-8292-929292929292', 'rlstest-c-mattias@example.test'),
  ('93939393-9393-4393-8393-939393939393', 'rlstest-c-lotta@example.test'),
  ('94949494-9494-4494-8494-949494949494', 'rlstest-c-kim@example.test');
insert into public.profiles (id, display_name, handle) values
  ('91919191-9191-4191-8191-919191919191', 'Järnis', 'rlstest_c_jarnis'),
  ('92929292-9292-4292-8292-929292929292', 'Mattias', 'rlstest_c_mattias'),
  ('93939393-9393-4393-8393-939393939393', 'Lotta', 'rlstest_c_lotta'),
  ('94949494-9494-4494-8494-949494949494', 'Kim', 'rlstest_c_kim');
insert into public.posts (author_id, body) values
  ('91919191-9191-4191-8191-919191919191', 'Testinlägg för räkning'),
  ('93939393-9393-4393-8393-939393939393', 'Testinlägg för räkning');
insert into public.post_comments (post_id, author_id, body)
  select id, '94949494-9494-4494-8494-949494949494', 'Testkommentar' from public.posts
   where author_id = '91919191-9191-4191-8191-919191919191' limit 1;
insert into public.supporter_follows (follower_id, followed_id) values
  ('92929292-9292-4292-8292-929292929292', '91919191-9191-4191-8191-919191919191'),
  ('93939393-9393-4393-8393-939393939393', '91919191-9191-4191-8191-919191919191'),
  ('91919191-9191-4191-8191-919191919191', '93939393-9393-4393-8393-939393939393'),
  ('93939393-9393-4393-8393-939393939393', '94949494-9494-4494-8494-949494949494'),
  ('91919191-9191-4191-8191-919191919191', '92929292-9292-4292-8292-929292929292');

-- ── The function itself ─────────────────────────────────────────────────
select ok((select prosecdef from pg_proc where oid = 'public.supporter_follow_counts(uuid)'::regprocedure), 'runs as its owner (security definer)');
select ok((select proconfig = array['search_path=""'] from pg_proc where oid = 'public.supporter_follow_counts(uuid)'::regprocedure), 'with an empty search_path');
select ok((select provolatile = 's' from pg_proc where oid = 'public.supporter_follow_counts(uuid)'::regprocedure), 'stable: it only reads');
select ok(
  (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.supporter_follow_counts(uuid)'::regprocedure)
    = (select tableowner::text from pg_tables where schemaname = 'public' and tablename = 'supporter_follows'),
  'owned by the role that owns supporter_follows');
select ok(not exists (select 1 from pg_class where oid in ('public.supporter_follows'::regclass, 'public.posts'::regclass, 'public.post_comments'::regclass) and relforcerowsecurity),
  'RLS is not forced on the tables it counts, so its owner reads them all');
select is((select proargnames::text from pg_proc where oid = 'public.supporter_follow_counts(uuid)'::regprocedure), '{p_profile_id,followers,following}', 'it returns two numbers and nothing else');
select ok(has_function_privilege('anon', 'public.supporter_follow_counts(uuid)', 'execute'), 'anon may ask (public counts)');
select ok(has_function_privilege('authenticated', 'public.supporter_follow_counts(uuid)', 'execute'), 'signed-in supporters may ask');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.supporter_follow_counts(uuid)'::regprocedure and a.grantee = 0), 'never granted to PUBLIC');

-- ── Following v1 is unchanged ───────────────────────────────────────────
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'supporter_follows' and grantee in ('anon', 'PUBLIC')), 0, 'anon still has no access to follows');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'supporter_follows'), 3, 'supporter_follows keeps its three policies');

-- ── Signed out ──────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq($$ select followers || '/' || following from public.supporter_follow_counts('91919191-9191-4191-8191-919191919191') $$, array['2/1'], 'Järnis: 2 followers (a private one among them), following 1 (his private follow is left out)');
select results_eq($$ select followers || '/' || following from public.supporter_follow_counts('93939393-9393-4393-8393-939393939393') $$, array['1/2'], 'Lotta: 1 follower, following 2 (Järnis and Kim)');
select results_eq($$ select followers || '/' || following from public.supporter_follow_counts('94949494-9494-4494-8494-949494949494') $$, array['1/0'], 'Kim, public through a comment: 1 follower');
select is_empty($$ select 1 from public.supporter_follow_counts('92929292-9292-4292-8292-929292929292') $$, 'a private supporter: no row');
select is_empty($$ select 1 from public.supporter_follow_counts('95959595-9595-4595-8595-959595959595') $$, 'a missing account: the very same answer');
select throws_ok($$ select 1 from public.supporter_follows $$, '42501', null, 'and still no follows to read');
select is(
  (select count(*)::int from (values ('91919191-9191-4191-8191-919191919191'::uuid), ('92929292-9292-4292-8292-929292929292'), ('93939393-9393-4393-8393-939393939393'), ('94949494-9494-4494-8494-949494949494'), ('95959595-9595-4595-8595-959595959595')) ids(id)
    where exists (select 1 from public.supporter_follow_counts(ids.id)) <> exists (select 1 from public.profiles p where p.id = ids.id)),
  0, 'signed out: counts exactly for the profiles anon may read');
reset role;

-- ── Lotta (public, signed in) ───────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"93939393-9393-4393-8393-939393939393","role":"authenticated"}', true);
select results_eq($$ select followers || '/' || following from public.supporter_follow_counts('91919191-9191-4191-8191-919191919191') $$, array['2/1'], 'signed in: the same public numbers');
select is_empty($$ select 1 from public.supporter_follow_counts('92929292-9292-4292-8292-929292929292') $$, 'someone else''s private profile: still no row');
select is_empty($$ select 1 from public.supporter_follows where followed_id = '93939393-9393-4393-8393-939393939393' $$, 'Lotta knows she has a follower, never who');
select is(
  (select count(*)::int from (values ('91919191-9191-4191-8191-919191919191'::uuid), ('92929292-9292-4292-8292-929292929292'), ('93939393-9393-4393-8393-939393939393'), ('94949494-9494-4494-8494-949494949494'), ('95959595-9595-4595-8595-959595959595')) ids(id)
    where exists (select 1 from public.supporter_follow_counts(ids.id)) <> exists (select 1 from public.profiles p where p.id = ids.id)),
  0, 'signed in: counts exactly for the profiles Lotta may read');
reset role;

-- ── Mattias (private) on his own place ──────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92929292-9292-4292-8292-929292929292","role":"authenticated"}', true);
select results_eq($$ select followers || '/' || following from public.supporter_follow_counts('92929292-9292-4292-8292-929292929292') $$, array['1/1'], 'a private supporter sees their own numbers');
select is(
  (select count(*)::int from (values ('91919191-9191-4191-8191-919191919191'::uuid), ('92929292-9292-4292-8292-929292929292'), ('93939393-9393-4393-8393-939393939393'), ('94949494-9494-4494-8494-949494949494'), ('95959595-9595-4595-8595-959595959595')) ids(id)
    where exists (select 1 from public.supporter_follow_counts(ids.id)) <> exists (select 1 from public.profiles p where p.id = ids.id)),
  0, 'the owner: counts exactly for the profiles Mattias may read (his own included)');
reset role;

-- ── The numbers follow follows ──────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"94949494-9494-4494-8494-949494949494","role":"authenticated"}', true);
select lives_ok($$ select public.follow_supporter('91919191-9191-4191-8191-919191919191') $$, 'Kim follows Järnis');
select results_eq($$ select followers::text from public.supporter_follow_counts('91919191-9191-4191-8191-919191919191') $$, array['3'], 'Järnis now has 3 followers');
select set_config('request.jwt.claims', '{"sub":"93939393-9393-4393-8393-939393939393","role":"authenticated"}', true);
select lives_ok($$ select public.unfollow_supporter('91919191-9191-4191-8191-919191919191') $$, 'Lotta stops following Järnis');
select results_eq($$ select followers::text from public.supporter_follow_counts('91919191-9191-4191-8191-919191919191') $$, array['2'], 'and he is back to 2');
reset role;
select set_config('request.jwt.claims', '', true);

-- Kim goes private again (her only comment removed): Lotta still follows her,
-- but "following" counts public supporters only, like "Du följer".
delete from public.post_comments where author_id = '94949494-9494-4494-8494-949494949494';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq($$ select following::text from public.supporter_follow_counts('93939393-9393-4393-8393-939393939393') $$, array['0'], 'a followed supporter gone private no longer counts in "following"');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
