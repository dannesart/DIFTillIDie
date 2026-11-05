-- Durable Story references (posts.story_ref via publish_post), against a
-- real Supabase database.
--
-- Run with the Supabase CLI (`supabase test db`) or any pgTAP runner, as a
-- role that may insert into auth.users and use Vault (e.g. postgres).
-- Everything, including the test signing key put in Vault, happens in one
-- transaction that is ROLLED BACK at the end. Don't run against production.
--
-- The captures are signed here with pgcrypto, the same HMAC-SHA256 the app
-- server computes in Node (tests/story-refs-db.test.ts checks they agree).

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('61616161-6161-4161-8161-616161616161', 'rlstest-hasse@example.test'),
  ('62626262-6262-4262-8262-626262626262', 'rlstest-nils@example.test');
select vault.create_secret('rlstest-secret-not-for-production', 'story_capture_key:rlstest');

-- Captures: one good, two edited after signing, one signed with an unknown key, one well-signed but malformed.
create temporary table caps (name text primary key, data text, sig text) on commit drop;
insert into caps (name, data) values
  ('good', '{"v":1,"kid":"rlstest","storyId":"story-rlstest-a","leadKey":"' || repeat('a', 64) || '","sources":[{"key":"' || repeat('a', 64) || '","id":"rlstest-a","sourceId":"x","outlet":"Sportbladet","publisher":"Aftonbladet","headline":"Derbyt avgjort: ”Vilken kväll” 💙","url":"https://example.se/a","publishedAt":"2026-11-04T18:00:00.000Z","capturedAt":"2026-11-04T18:05:00.000Z","reporting":"original","sport":"fotboll"},{"key":"' || repeat('b', 64) || '","id":"rlstest-b","sourceId":"y","outlet":"Expressen","publisher":"Expressen","headline":"Djurgården vann derbyt","url":"https://example.se/b","publishedAt":"2026-11-04T18:30:00.000Z","capturedAt":null,"reporting":"original","sport":"fotboll"}]}'),
  ('unknown-kid', '{"v":1,"kid":"rlstest-unknown","storyId":"story-rlstest-a","leadKey":"' || repeat('a', 64) || '","sources":[{"key":"' || repeat('a', 64) || '","id":"rlstest-a","sourceId":"x","outlet":"Sportbladet","publisher":"Aftonbladet","headline":"Derbyt","url":"https://example.se/a","publishedAt":"2026-11-04T18:00:00.000Z","capturedAt":null,"reporting":"original","sport":"fotboll"}]}'),
  ('bad-url', '{"v":1,"kid":"rlstest","storyId":"story-rlstest-a","leadKey":"' || repeat('a', 64) || '","sources":[{"key":"' || repeat('a', 64) || '","id":"rlstest-a","sourceId":"x","outlet":"Sportbladet","publisher":"Aftonbladet","headline":"Derbyt","url":"javascript:alert(1)","publishedAt":"2026-11-04T18:00:00.000Z","capturedAt":null,"reporting":"original","sport":"fotboll"}]}');
update caps set sig = encode(extensions.hmac(data, 'rlstest-secret-not-for-production', 'sha256'), 'hex');
insert into caps (name, data, sig)
  select 'edited-headline', replace(data, 'Derbyt avgjort', 'Djurgården köper Messi'), sig from caps where name = 'good'
  union all
  select 'dropped-source', regexp_replace(data, ',\{"key":"b+".*\}\]\}$', ']}'), sig from caps where name = 'good';
grant select on caps to authenticated, anon;

select is((select count(*)::int from caps where sig is not null), 5, 'test captures are ready');
select ok(not has_function_privilege('anon', 'public.publish_post(text, text, text, text)', 'execute'), 'anon cannot execute publish_post');

-- ── Hasse: profile, then a post with a Story ─────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61616161-6161-4161-8161-616161616161","role":"authenticated"}', true);
insert into public.profiles (id, display_name, handle) values ('61616161-6161-4161-8161-616161616161', 'Hovet-Hasse', 'rlstest_hasse');

select throws_ok($$ select decrypted_secret from vault.decrypted_secrets $$, '42501', null, 'supporters cannot read the signing key');
select lives_ok($$ select public.publish_post('Vilket derby! #dif', 'fotboll', (select data from caps where name = 'good'), (select sig from caps where name = 'good')) $$, 'Hasse publishes with a signed Story');
-- now() is this transaction's start time: only rows this suite made.
select results_eq($$ select story_id from public.posts where created_at = now() $$, array['story-rlstest-a'], 'the post refers to the signed Story');
select results_eq($$ select jsonb_array_length(story_ref -> 'sources')::text from public.posts where created_at = now() $$, array['2'], 'with exactly the two sources that were attached');
select results_eq($$ select story_ref -> 'sources' -> 0 ->> 'headline' from public.posts where created_at = now() $$, array['Derbyt avgjort: ”Vilken kväll” 💙'], 'and each outlet''s own headline, exactly');

select throws_ok($$ select public.publish_post('Fejk', null, (select data from caps where name = 'edited-headline'), (select sig from caps where name = 'edited-headline')) $$, '22023', null, 'an edited headline is refused');
select throws_ok($$ select public.publish_post('Fejk', null, (select data from caps where name = 'dropped-source'), (select sig from caps where name = 'dropped-source')) $$, '22023', null, 'a dropped source is refused');
select throws_ok($$ select public.publish_post('Fejk', null, (select data from caps where name = 'good'), null) $$, '22023', null, 'an unsigned capture is refused');
select throws_ok($$ select public.publish_post('Fejk', null, (select data from caps where name = 'unknown-kid'), (select sig from caps where name = 'unknown-kid')) $$, '22023', null, 'a capture signed with an unknown key is refused');
select throws_ok($$ select public.publish_post('Fejk', null, (select data from caps where name = 'bad-url'), (select sig from caps where name = 'bad-url')) $$, '22023', null, 'a signed but malformed capture is refused');
select results_eq($$ select count(*)::text from public.posts where created_at = now() $$, array['1'], 'refused attempts published nothing');

select throws_ok($$ update public.posts set story_ref = '{}'::jsonb $$, '42501', null, 'a frozen Story can never be changed, not even by the author');
select throws_ok($$ insert into public.posts (body, story_id, story_ref) values ('Direkt', 'story-x', '{"storyId":"story-x"}') $$, '42501', null, 'a frozen Story can never be written directly');

select * from finish();
rollback;
