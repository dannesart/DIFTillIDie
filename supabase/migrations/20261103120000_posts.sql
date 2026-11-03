-- Real Snacket posts for Djurgår'n tills jag dör.
--
-- One journey: a signed-in supporter with a profile publishes a short post,
-- and anyone, signed in or not, can read it.
--
-- Access, enforced by the database:
--   anon            read posts; read the public name (id, display_name, handle)
--                   of supporters who have published at least one post
--   authenticated   the same, plus: publish posts as themselves (only with a
--                   profile), and delete their own posts
--   nobody          can edit a post, choose its author or its timestamp, or
--                   touch someone else's post via the API
--
-- The author is never taken from the client: author_id has no INSERT grant
-- and defaults to auth.uid(), and the policy checks it again.
--
-- Future approval-required participation: "may publish" is decided in ONE
-- place, the insert policy below. Today it means "has a profile"; an approval
-- or membership check is added there later without touching the client.

create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null,
  sport      text,
  story_id   text,
  created_at timestamptz not null default now(),

  constraint posts_body_length check (char_length(body) between 1 and 280),
  constraint posts_body_trimmed check (body !~ '^\s' and body !~ '\s$'),
  -- Newlines are fine; other control characters are not.
  constraint posts_body_printable check (body !~ '[\x01-\x09\x0b-\x1f\x7f]'),
  constraint posts_sport check (sport in ('fotboll', 'hockey')),
  constraint posts_story_id_format check (story_id ~ '^[A-Za-z0-9_.:-]{1,200}$')
);

comment on table public.posts is 'Public Snacket posts. Readable by everyone; published only by the signed-in author with a profile; deletable only by the author; never editable.';

create index posts_created_at_idx on public.posts (created_at desc, id desc);
create index posts_author_id_idx on public.posts (author_id);

-- Explicit grants. Supabase's default privileges give anon/authenticated ALL
-- on new public tables, so start from nothing and add back only what's needed.
revoke all on table public.posts from public, anon, authenticated;

grant select on table public.posts to anon, authenticated;
grant insert (body, sport, story_id) on table public.posts to authenticated;
grant delete on table public.posts to authenticated;
grant all on table public.posts to service_role;

alter table public.posts enable row level security;

create policy "Anyone can read posts"
  on public.posts for select
  to anon, authenticated
  using (true);

create policy "Supporters with a profile can publish as themselves"
  on public.posts for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );

create policy "Supporters can delete their own posts"
  on public.posts for delete
  to authenticated
  using (author_id = (select auth.uid()));

-- ── Public author names ─────────────────────────────────────────────────
-- Posts need a visible author. Publishing makes your display name and handle
-- public; until then your profile stays private. Only those columns (and the
-- id the posts point at) are readable — never the profile's timestamps, and
-- profiles never hold an e-mail address at all.
revoke select on table public.profiles from authenticated;
grant select (id, display_name, handle) on table public.profiles to anon, authenticated;

create policy "Anyone can see the public name of supporters who have posted"
  on public.profiles for select
  to anon, authenticated
  using (exists (select 1 from public.posts where posts.author_id = profiles.id));
