-- Direct replies to comments (20261116120000_comment_replies.sql), against a
-- real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users (e.g. postgres). Everything happens in
-- one transaction that is ROLLED BACK at the end. Don't run against
-- production. Safe on a database that already has real comments and replies:
-- every assertion is scoped to this suite's own users and posts.
--
-- Users: Järnis (publishes two posts), Mattias and Lotta (comment and reply),
-- Nils (signed in, no profile).
-- Mirrors tests/comment-replies-db.test.ts, which runs locally.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('81818181-8181-4181-8181-818181818181', 'replytest-jarnis@example.test'),
  ('82828282-8282-4282-8282-828282828282', 'replytest-mattias@example.test'),
  ('83838383-8383-4383-8383-838383838383', 'replytest-lotta@example.test'),
  ('84848484-8484-4484-8484-848484848484', 'replytest-nils@example.test');

-- ── Structure ────────────────────────────────────────────────────────────
-- information_schema text is collation "C"; pgTAP compares rows with the
-- expected array (default collation) and refuses mixed collations, hence
-- the explicit collate "default" here and below.
select results_eq(
  $$ select (column_name::text || ':' || data_type::text || ':' || is_nullable::text) collate "default" from information_schema.columns where table_schema = 'public' and table_name = 'post_comments' and column_name in ('parent_comment_id', 'is_reply') order by 1 $$,
  array['is_reply:boolean:NO', 'parent_comment_id:uuid:YES'], 'post_comments has parent_comment_id (nullable) and is_reply (not null)');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.post_comments'::regclass and conname = 'post_comments_parent_fkey')
    like 'FOREIGN KEY (parent_comment_id, post_id) REFERENCES %post_comments(id, post_id) ON DELETE SET NULL (parent_comment_id)',
  'the parent is a comment on the same post; deleting it clears only parent_comment_id');
select results_eq(
  $$ select column_name::text collate "default" from information_schema.column_privileges where table_schema = 'public' and table_name = 'post_comments' and grantee = 'authenticated' and privilege_type = 'INSERT' order by 1 $$,
  array['body', 'parent_comment_id', 'post_id'], 'authenticated may only write post_id, body and parent_comment_id');
select is_empty(
  $$ select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'post_comments' and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE' $$,
  'nobody may update a comment');
select ok(
  not has_function_privilege('anon', 'public.post_comments_reply_guard()', 'execute') and not has_function_privilege('authenticated', 'public.post_comments_reply_guard()', 'execute'),
  'the reply guard is not callable through the API');

-- ── Profiles; Järnis publishes two posts ─────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-4181-8181-818181818181","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('81818181-8181-4181-8181-818181818181', 'Järnis', 'replytest_jarnis');
do $$ begin perform public.publish_post('Svarstest'); perform public.publish_post('Svarstest två'); end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('82828282-8282-4282-8282-828282828282', 'Mattias', 'replytest_mattias');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('83838383-8383-4383-8383-838383838383', 'Lotta', 'replytest_lotta');
reset role;

-- ── Mattias comments; Lotta answers; Mattias answers her ─────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select lives_ok($$ insert into public.post_comments (post_id, body) select id, 'A' from public.posts where author_id = '81818181-8181-4181-8181-818181818181' and body = 'Svarstest' $$, 'Mattias comments as before');
select results_eq($$ select format('%s/%s', (parent_comment_id is null)::text, is_reply::text) from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'A' $$, array['true/false'], 'an ordinary comment: no parent, not a reply');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
select lives_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select post_id, 'B', id from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'A' $$, 'Lotta answers Mattias');
select results_eq($$ select format('%s/%s', author_id, is_reply::text) from public.post_comments where body = 'B' and parent_comment_id = (select id from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'A') $$, array['83838383-8383-4383-8383-838383838383/true'], 'the reply is Lotta''s, answers A, and the database marks it a reply');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select lives_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select post_id, 'C', id from public.post_comments where author_id = '83838383-8383-4383-8383-838383838383' and body = 'B' $$, 'Mattias answers Lotta''s reply');
select throws_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select p.id, 'Fel inlägg', c.id from public.posts p, public.post_comments c where p.author_id = '81818181-8181-4181-8181-818181818181' and p.body = 'Svarstest två' and c.author_id = '82828282-8282-4282-8282-828282828282' and c.body = 'A' $$, '23503', null, 'a reply to a comment on another post is refused');
select throws_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select id, 'Finns inte', '99999999-9999-4999-8999-999999999999' from public.posts where author_id = '81818181-8181-4181-8181-818181818181' and body = 'Svarstest' $$, '23503', null, 'a reply to a comment that doesn''t exist is refused');
select throws_ok($$ insert into public.post_comments (post_id, body, is_reply) select id, 'Låtsassvar', true from public.posts where author_id = '81818181-8181-4181-8181-818181818181' and body = 'Svarstest' $$, '42501', null, 'is_reply cannot be supplied');
select throws_ok($$ insert into public.post_comments (post_id, body, parent_comment_id, author_id) select post_id, 'Som Lotta', id, '83838383-8383-4383-8383-838383838383' from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'A' $$, '42501', null, 'a reply cannot be published as someone else');
select throws_ok($$ update public.post_comments set parent_comment_id = null where author_id = '82828282-8282-4282-8282-828282828282' and body = 'C' $$, '42501', null, 'a reply cannot be moved or detached, not even by its author');
select throws_ok($$ update public.post_comments set is_reply = false where author_id = '82828282-8282-4282-8282-828282828282' and body = 'C' $$, '42501', null, 'a reply cannot be unmarked');
reset role;

-- ── Nils (no profile) and anonymous visitors ────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"84848484-8484-4484-8484-848484848484","role":"authenticated"}', true);
select throws_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select post_id, 'Utan profil', id from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'A' $$, '42501', null, 'without a profile you cannot reply');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select post_id, 'Anonym', id from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'A' $$, '42501', null, 'anon cannot reply');
select results_eq($$ select body || ':' || is_reply from public.post_comments where author_id in ('82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383') order by body $$, array['A:false', 'B:true', 'C:true'], 'anon reads comments and replies, and which are replies');
reset role;
select set_config('request.jwt.claims', '', true);

-- ── Not even a privileged role can make a comment answer itself ──────────
select throws_ok($$ insert into public.post_comments (id, post_id, author_id, body, parent_comment_id) select '85858585-8585-4585-8585-858585858585', id, '82828282-8282-4282-8282-828282828282', 'Själv', '85858585-8585-4585-8585-858585858585' from public.posts where author_id = '81818181-8181-4181-8181-818181818181' and body = 'Svarstest' $$, '23514', null, 'a comment cannot answer itself');

-- ── Mattias deletes A: Lotta's reply stays, as a reply to a deleted comment
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated"}', true);
select results_eq($$ delete from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'A' returning body $$, array['A'], 'Mattias deletes the comment Lotta answered');
reset role;
select set_config('request.jwt.claims', '', true);
select results_eq($$ select format('%s/%s', (parent_comment_id is null)::text, is_reply::text) from public.post_comments where author_id = '83838383-8383-4383-8383-838383838383' and body = 'B' $$, array['true/true'], 'B remains, still a reply, its parent cleared');
select results_eq($$ select (parent_comment_id = (select id from public.post_comments where author_id = '83838383-8383-4383-8383-838383838383' and body = 'B'))::text from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'C' $$, array['true'], 'C still answers B');
select throws_ok($$ update public.post_comments set parent_comment_id = null where author_id = '82828282-8282-4282-8282-828282828282' and body = 'C' $$, '23514', null, 'not even a privileged role can detach a reply whose parent exists');

-- ── Mattias's account goes: his comments go, Lotta's replies stay ────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
select lives_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select post_id, 'D', id from public.post_comments where author_id = '82828282-8282-4282-8282-828282828282' and body = 'C' $$, 'Lotta answers C');
reset role;
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = '82828282-8282-4282-8282-828282828282' $$, 'an account with comments and replies, and replies to them, can be deleted');
select results_eq($$ select body || ':' || (parent_comment_id is null) || ':' || is_reply from public.post_comments where author_id in ('82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383') order by body $$, array['B:true:true', 'D:true:true'], 'his comments are gone; Lotta''s replies remain, as replies to deleted comments');

-- ── Järnis deletes the post, reply chain and all ─────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated"}', true);
select lives_ok($$ insert into public.post_comments (post_id, body, parent_comment_id) select post_id, 'E', id from public.post_comments where author_id = '83838383-8383-4383-8383-838383838383' and body = 'D' $$, 'Lotta answers herself');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81818181-8181-4181-8181-818181818181","role":"authenticated"}', true);
select results_eq($$ delete from public.posts where author_id = '81818181-8181-4181-8181-818181818181' and body = 'Svarstest' returning body $$, array['Svarstest'], 'a post with a reply chain can be deleted');
reset role;
select set_config('request.jwt.claims', '', true);
select is_empty($$ select 1 from public.post_comments where author_id in ('82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383') $$, 'its comments and replies went with it');

select * from finish();
rollback;
