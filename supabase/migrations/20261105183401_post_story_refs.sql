-- Durable Story references for Snacket posts.
--
-- A post about a Story used to keep only `story_id`, which points at
-- articles in the live RSS feeds; once those leave the feeds, the post lost
-- what it was about. Now a post keeps the Story itself, frozen at the
-- moment it was published: exactly the sources the supporter attached,
-- with each outlet's own headline, publisher, URL and dates, as our server
-- read them from the publishers' feeds. Never article text.
--
-- Trust: the frozen Story comes from the browser, so it must be one our
-- server produced. The server signs each Story it builds (HMAC-SHA256,
-- server/lib/capture.ts); publish_post() checks that signature with the
-- same key, kept in Supabase Vault as `story_capture_key:<kid>`. A capture
-- that's edited, unsigned, signed with an unknown key or malformed is
-- refused, and then nothing is published: the post and its reference are
-- written together or not at all.
--
-- Publishing goes through publish_post(), where "who may publish" now
-- lives (it used to be the insert policy): an approval or membership check
-- goes there.
--
-- This migration only ADDS (column, check, function), so the app that is
-- live while it's applied keeps publishing the old way. Direct inserts are
-- closed by the next migration, 20261105090100_close_direct_post_inserts,
-- once the app that uses publish_post() is deployed. See "Deploying" in
-- docs/snacket-posts.md.
--
-- Posts published before this migration keep their bare story_id and no
-- story_ref. Nothing here guesses what they were about; the app shows their
-- Story while it is still in the feeds, and says it's unavailable after.

create extension if not exists pgcrypto with schema extensions;

alter table public.posts add column story_ref jsonb;

comment on column public.posts.story_ref is
  'The attached Story frozen at publication (FrozenStory: kid, storyId, leadKey, sources[]), verified by publish_post(). As captured from the publishers'' feeds, not necessarily the articles'' first versions. Null for posts without a Story, and for Story posts from before 2026-11-05.';

alter table public.posts
  add constraint posts_story_ref_matches
  check (story_ref is null or (story_id is not null and story_ref ->> 'storyId' = story_id));

-- ── Publishing: one function, one transaction ───────────────────────────
-- story_ref has no insert grant, so the old insert path can never set it.
create function public.publish_post(
  p_body text,
  p_sport text default null,
  p_story text default null,
  p_story_sig text default null
)
returns public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ref jsonb;
  secret text;
  post public.posts;
begin
  -- Who may publish: a signed-in supporter with a profile, as themselves.
  if uid is null or not exists (select 1 from public.profiles p where p.id = uid) then
    raise exception 'only a signed-in supporter with a profile can publish' using errcode = '42501';
  end if;

  if p_story is not null or p_story_sig is not null then
    if p_story is null or p_story_sig is null or char_length(p_story) > 32768 then
      raise exception 'story capture not verified' using errcode = '22023';
    end if;
    begin
      ref := p_story::jsonb;
    exception when others then
      raise exception 'story capture not verified' using errcode = '22023';
    end;
    if jsonb_typeof(ref) is distinct from 'object' then
      raise exception 'story capture not verified' using errcode = '22023';
    end if;

    -- The signature covers the exact text that was sent.
    select s.decrypted_secret into secret
    from vault.decrypted_secrets s
    where s.name = 'story_capture_key:' || (ref ->> 'kid');
    if secret is null
      or encode(extensions.hmac(p_story, secret, 'sha256'), 'hex') is distinct from lower(p_story_sig) then
      raise exception 'story capture not verified' using errcode = '22023';
    end if;

    -- Signed by our server, and still checked: a bug must not freeze junk.
    if (ref ->> 'v') is distinct from '1'
      or coalesce(ref ->> 'storyId', '') !~ '^[A-Za-z0-9_.:-]{1,200}$'
      or jsonb_typeof(ref -> 'sources') is distinct from 'array'
      or jsonb_array_length(ref -> 'sources') not between 1 and 20
      or not exists (select 1 from jsonb_array_elements(ref -> 'sources') e where e ->> 'key' = ref ->> 'leadKey')
      or exists (
        select 1 from jsonb_array_elements(ref -> 'sources') e
        where coalesce(e ->> 'key', '') !~ '^[0-9a-f]{64}$'
          or coalesce(e ->> 'url', '') !~ '^https?://'
          or char_length(coalesce(e ->> 'headline', '')) not between 1 and 500
          or coalesce(e ->> 'outlet', '') = ''
          or coalesce(e ->> 'publisher', '') = ''
      ) then
      raise exception 'story capture not verified' using errcode = '22023';
    end if;
  end if;

  insert into public.posts (author_id, body, sport, story_id, story_ref)
  values (uid, p_body, p_sport, ref ->> 'storyId', ref)
  returning * into post;
  return post;
end
$$;

comment on function public.publish_post(text, text, text, text) is
  'Publish a Snacket post as the signed-in supporter, optionally with a Story capture signed by our server. Post and frozen Story are written together, or nothing is.';

revoke all on function public.publish_post(text, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_post(text, text, text, text) to authenticated;
