-- Supporter profiles: a bio, an avatar design, and private team interests.
--
-- Additive only: existing profiles and posts are untouched, and the app in
-- production keeps working (it selects its columns by name).
--
-- Public, under the SAME conditions as the name and handle (the profile's
-- author has posted or commented; see the posts and comments migrations):
--   bio      optional, the supporter's own words
--   avatar   optional, one of a fixed set of designs drawn by the app
--            (null = the striped initials everyone has today). No uploads,
--            no photos, no club marks: there is nothing to moderate but text.
-- Nothing here changes who can see a profile. Before posting or commenting,
-- only the supporter themselves can read it, bio included.
--
-- Owner-only, never readable by anyone else (not even other supporters):
--   profile_preferences.teams   which teams the supporter follows:
--                               fotboll:herr, fotboll:dam, hockey:herr, hockey:dam
-- A separate table because column grants are per role, not per row: a
-- column on profiles that the owner may read could be read on every public
-- profile too. Preferences are stored and shown to their owner; the app
-- never uses them to hide content.
--
-- Later, not now: a private profile wall or followers-only posts would be a
-- separate change to the posts read policy (one function deciding who sees
-- whose posts). Nothing here pretends to offer that.

-- ── Bio and avatar ──────────────────────────────────────────────────────
alter table public.profiles
  add column bio text,
  add column avatar text;

alter table public.profiles
  add constraint profiles_bio_trimmed check (bio = btrim(bio)),
  add constraint profiles_bio_length check (char_length(bio) between 1 and 160),
  -- One paragraph: no newlines or other control characters.
  add constraint profiles_bio_printable check (bio !~ '[[:cntrl:]]'),
  -- Mirrors AVATARS in shared/utils/profile.ts.
  add constraint profiles_avatar_design check (avatar in ('himmel', 'tricolor', 'stjarna', 'halsduk', 'boll', 'puck', 'trumma'));

comment on column public.profiles.bio is 'Optional, public under the same conditions as display_name and handle.';
comment on column public.profiles.avatar is 'Optional avatar design key (drawn by the app); null = striped initials.';

-- Same pattern as display_name and handle: readable where the row is,
-- writable by the owner only (the existing policies decide which rows).
grant select (bio, avatar) on table public.profiles to anon, authenticated;
grant insert (bio, avatar) on table public.profiles to authenticated;
grant update (bio, avatar) on table public.profiles to authenticated;

-- ── Team interests (owner only) ─────────────────────────────────────────
create table public.profile_preferences (
  profile_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  teams      text[] not null default '{}',
  updated_at timestamptz not null default now(),

  -- Mirrors TEAM_INTERESTS in shared/utils/profile.ts. Empty is fine.
  constraint profile_preferences_teams check (
    teams <@ array['fotboll:herr', 'fotboll:dam', 'hockey:herr', 'hockey:dam']::text[]
    and array_position(teams, null) is null
  )
);

comment on table public.profile_preferences is 'A supporter''s own team interests. Owner-only via RLS; never public, never used to filter content.';

-- Sorted, without duplicates, and updated_at set by the database.
create function public.profile_preferences_normalize()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.teams := array(select distinct t from unnest(new.teams) as t order by t);
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.profile_preferences_normalize() from public, anon, authenticated;

create trigger profile_preferences_normalize
  before insert or update on public.profile_preferences
  for each row execute function public.profile_preferences_normalize();

-- Explicit grants. Supabase's default privileges give anon/authenticated ALL
-- on new public tables, so start from nothing and add back only what's needed.
-- profile_id is never written by the client: it defaults to auth.uid().
revoke all on table public.profile_preferences from public, anon, authenticated;

grant select on table public.profile_preferences to authenticated;
grant insert (teams) on table public.profile_preferences to authenticated;
grant update (teams) on table public.profile_preferences to authenticated;
grant all on table public.profile_preferences to service_role;

alter table public.profile_preferences enable row level security;

create policy "Supporters can read their own preferences"
  on public.profile_preferences for select
  to authenticated
  using (profile_id = (select auth.uid()));

create policy "Supporters can create their own preferences"
  on public.profile_preferences for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

create policy "Supporters can update their own preferences"
  on public.profile_preferences for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Save your team interests in one call (create or replace). SECURITY
-- INVOKER: the grants and policies above apply exactly as written.
create function public.save_team_interests(p_teams text[])
returns public.profile_preferences
language sql
security invoker
set search_path = ''
as $$
  insert into public.profile_preferences (teams) values (coalesce(p_teams, '{}'))
  on conflict (profile_id) do update set teams = excluded.teams
  returning *;
$$;

revoke all on function public.save_team_interests(text[]) from public, anon, authenticated;
grant execute on function public.save_team_interests(text[]) to authenticated, service_role;

-- ── A supporter's wall ──────────────────────────────────────────────────
-- Their posts, newest first, a page at a time.
create index posts_author_created_at_idx on public.posts (author_id, created_at desc, id desc);
