-- Authorization tests for public.post_comments, public.post_reactions,
-- set_post_reaction() and post_stats(), against a real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end: test users, profiles, the
-- post, comments and reactions are never committed. Don't run against
-- production.
--
-- Safe on a database that already has real supporters, posts, comments and
-- reactions: every assertion is scoped to this suite's own users and post.
--
-- Users: Järnis (publishes), Mattias (reacts and comments), Lotta (reacts,
-- comments only at the end), Nils (signed in, no profile).
-- Mirrors tests/interactions-db.test.ts, which runs locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (id, email) values
  ('71717171-7171-4171-8171-717171717171', 'rlstest-jarnis@example.test'),
  ('72727272-7272-4272-8272-727272727272', 'rlstest-mattias@example.test'),
  ('73737373-7373-4373-8373-737373737373', 'rlstest-lotta@example.test'),
  ('74747474-7474-4474-8474-747474747474', 'rlstest-nils@example.test');

-- ── Structure ────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.post_comments'::regclass), 'RLS is enabled on post_comments');
select ok((select relrowsecurity from pg_class where oid = 'public.post_reactions'::regclass), 'RLS is enabled on post_reactions');
select is(
  (select array_agg(privilege_type::text order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'post_comments' and grantee = 'anon'),
  array['SELECT'], 'anon may only read comments');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'post_reactions' and grantee in ('anon', 'public')),
  0, 'anon has no access to reaction rows at all');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges where table_schema = 'public' and table_name = 'post_comments' and grantee = 'authenticated' and privilege_type = 'INSERT'),
  array['body', 'post_id'], 'comments: authenticated may only write post_id and body');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges where table_schema = 'public' and table_name = 'post_reactions' and grantee = 'authenticated' and privilege_type = 'INSERT'),
  array['post_id', 'reaction'], 'reactions: authenticated may only write post_id and reaction');
select ok(not has_function_privilege('anon', 'public.set_post_reaction(uuid, text)', 'execute'), 'anon cannot execute set_post_reaction');
select ok(has_function_privilege('anon', 'public.post_stats(uuid[])', 'execute'), 'anon can execute post_stats');

-- ── Profiles, made by their owners; Järnis publishes ─────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"71717171-7171-4171-8171-717171717171","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('71717171-7171-4171-8171-717171717171', 'Järnis', 'rlstest_jarnis');
insert into public.posts (body) values ('Testinlägg för interaktioner');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72727272-7272-4272-8272-727272727272","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('72727272-7272-4272-8272-727272727272', 'Mattias', 'rlstest_mattias');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"73737373-7373-4373-8373-737373737373","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('73737373-7373-4373-8373-737373737373', 'Lotta', 'rlstest_lotta');
reset role;

-- ── Mattias reacts and comments ──────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72727272-7272-4272-8272-727272727272","role":"authenticated"}', true);
select lives_ok($$ select public.set_post_reaction((select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171'), 'hjarta') $$, 'Mattias can react');
select results_eq($$ select public.set_post_reaction((select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171'), 'eld') $$, array['hjarta'], 'switching returns the previous reaction');
select results_eq($$ select reaction from public.post_reactions where post_id = (select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171') $$, array['eld'], 'one reaction, switched, visible to Mattias');
select throws_ok($$ insert into public.post_reactions (post_id, reaction) select id, 'stjarna' from public.posts where author_id = '71717171-7171-4171-8171-717171717171' $$, '23505', null, 'a second reaction on the same post is refused by the database');
select throws_ok($$ insert into public.post_reactions (post_id, user_id, reaction) select id, '73737373-7373-4373-8373-737373737373', 'stjarna' from public.posts where author_id = '71717171-7171-4171-8171-717171717171' $$, '42501', null, 'Mattias cannot react as Lotta');
select throws_ok($$ select public.set_post_reaction((select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171'), 'tumme') $$, '23514', null, 'unknown reactions are rejected');
select lives_ok($$ insert into public.post_comments (post_id, body) select id, 'Vilken kväll! 💙' from public.posts where author_id = '71717171-7171-4171-8171-717171717171' $$, 'Mattias can comment');
select results_eq($$ select author_id::text from public.post_comments where post_id = (select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171') $$, array['72727272-7272-4272-8272-727272727272'], 'the database sets Mattias as the comment author');
select throws_ok($$ insert into public.post_comments (post_id, body, author_id) select id, 'Jag är Lotta', '73737373-7373-4373-8373-737373737373' from public.posts where author_id = '71717171-7171-4171-8171-717171717171' $$, '42501', null, 'Mattias cannot comment as Lotta');
select throws_ok($$ update public.post_comments set body = 'Ändrad' where author_id = '72727272-7272-4272-8272-727272727272' $$, '42501', null, 'comments cannot be edited, not even by their author');
reset role;

-- ── Lotta reacts; can't see or touch Mattias's interactions ──────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"73737373-7373-4373-8373-737373737373","role":"authenticated"}', true);
select lives_ok($$ select public.set_post_reaction((select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171'), 'hjarta') $$, 'Lotta can react');
select is_empty($$ select user_id from public.post_reactions where user_id <> '73737373-7373-4373-8373-737373737373' $$, 'Lotta cannot see anyone else''s reactions');
select is_empty($$ update public.post_reactions set reaction = 'tarar' where user_id = '72727272-7272-4272-8272-727272727272' returning user_id $$, 'Lotta cannot change Mattias''s reaction');
select is_empty($$ delete from public.post_reactions where user_id = '72727272-7272-4272-8272-727272727272' returning user_id $$, 'Lotta cannot remove Mattias''s reaction');
select is_empty($$ delete from public.post_comments where author_id = '72727272-7272-4272-8272-727272727272' returning id $$, 'Lotta cannot delete Mattias''s comment');
reset role;

-- ── Nils: signed in, no profile ──────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74747474-7474-4474-8474-747474747474","role":"authenticated"}', true);
select throws_ok($$ select public.set_post_reaction((select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171'), 'hjarta') $$, '42501', null, 'without a profile you cannot react');
select throws_ok($$ insert into public.post_comments (post_id, body) select id, 'Utan profil' from public.posts where author_id = '71717171-7171-4171-8171-717171717171' $$, '42501', null, 'without a profile you cannot comment');
reset role;

-- ── Anonymous ────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select user_id from public.post_reactions $$, '42501', null, 'anon cannot see who reacted');
select throws_ok($$ select public.set_post_reaction((select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171'), 'hjarta') $$, '42501', null, 'anon cannot react');
select throws_ok($$ insert into public.post_comments (post_id, body) select id, 'Anonym' from public.posts where author_id = '71717171-7171-4171-8171-717171717171' $$, '42501', null, 'anon cannot comment');
select results_eq($$ select format('%s/%s/%s/%s/%s', hjarta, eld, stjarna, tarar, comments) from public.post_stats(array(select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171')) $$, array['1/1/0/0/1'], 'anon reads the totals: 1 💙, 1 🔥, 1 comment');
select results_eq($$ select handle from public.profiles where id in ('71717171-7171-4171-8171-717171717171', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373') order by handle $$, array['rlstest_jarnis', 'rlstest_mattias'], 'posting and commenting make a name public; Lotta only reacted and stays private');
select results_eq($$ select pr.handle from public.post_comments c join public.profiles pr on pr.id = c.author_id where c.author_id = '72727272-7272-4272-8272-727272727272' $$, array['rlstest_mattias'], 'anon sees the comment with its author''s public handle');
reset role;

-- ── Mattias takes it all back ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72727272-7272-4272-8272-727272727272","role":"authenticated"}', true);
select results_eq($$ select public.set_post_reaction((select id from public.posts where author_id = '71717171-7171-4171-8171-717171717171'), null) $$, array['eld'], 'tapping the same reaction again removes it (null), returning what it was');
select results_eq($$ delete from public.post_comments where author_id = '72727272-7272-4272-8272-727272727272' returning body $$, array['Vilken kväll! 💙'], 'Mattias can delete his own comment');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty($$ select id from public.profiles where id = '72727272-7272-4272-8272-727272727272' $$, 'with no comments or posts left, Mattias is private again');
reset role;

-- ── Järnis deletes the post: everyone's comments and reactions go too ────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"73737373-7373-4373-8373-737373737373","role":"authenticated"}', true);
select lives_ok($$ insert into public.post_comments (post_id, body) select id, 'Lottas kommentar' from public.posts where author_id = '71717171-7171-4171-8171-717171717171' $$, 'Lotta comments');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"71717171-7171-4171-8171-717171717171","role":"authenticated"}', true);
select results_eq($$ delete from public.posts returning body $$, array['Testinlägg för interaktioner'], 'Järnis deletes his own post (and only his)');
reset role;
select set_config('request.jwt.claims', '', true);
select is_empty($$ select 1 from public.post_reactions where user_id in ('72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373') $$, 'the post''s reactions were deleted with it');
select is_empty($$ select 1 from public.post_comments where author_id in ('72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373') $$, 'the post''s comments, including Lotta''s, were deleted with it');
select results_eq($$ select handle from public.profiles where id in ('71717171-7171-4171-8171-717171717171', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373') order by handle $$, array['rlstest_jarnis', 'rlstest_lotta', 'rlstest_mattias'], 'profiles themselves are untouched');

select * from finish();
rollback;
