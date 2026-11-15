-- Following supporters, v1 (issue #9): private and voluntary.
--
-- A supporter can follow another supporter whose läktarplats is public, and
-- stop again. Only the follower can see their own follows: nobody, not even
-- the supporter being followed, can read who follows whom, and there are no
-- counts. Nothing here notifies anyone, ranks anything or filters any feed.
--
-- Invariants, enforced by the database:
--   - a follow is (follower_id, followed_id), both user ids: handle changes
--     never touch it;
--   - one row per pair (primary key): following again changes nothing;
--   - nobody follows themself (check constraint);
--   - only a profile the follower may see can be followed. Profiles are
--     visible under the existing rule (public once their supporter has
--     posted or commented, and always to themselves), so "public" means
--     exactly what it means everywhere else. A missing account and a private
--     one give the same answer, so following can't be used to probe;
--   - the follower needs a profile, like posting, commenting and reacting;
--   - deleting an account (auth.users → profiles) deletes its follows, both
--     ways (on delete cascade).
--
-- A follow made while a profile was public stays if that supporter later
-- becomes private again (e.g. deletes their posts and comments), but nothing
-- of that profile is shown: followed_supporters() and every profile read go
-- through the profiles policy, which hides it.
--
-- Access:
--   anon            nothing
--   authenticated   read and remove ONLY their own follows; add one for
--                   themself, for a profile they may see; execute
--                   follow_supporter(), unfollow_supporter() and
--                   followed_supporters()
--   nobody          can choose follower_id, or read someone else's follows

create table public.supporter_follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followed_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),

  primary key (follower_id, followed_id),
  constraint supporter_follows_not_self check (follower_id <> followed_id)
);

comment on table public.supporter_follows is 'Who follows whom (#9). Private: owner-only rows via RLS; no counts, no lists of followers.';

-- The primary key serves the follower's own reads; this one the cascade when a followed account goes.
create index supporter_follows_followed_id_idx on public.supporter_follows (followed_id);

-- Explicit grants. Supabase's default privileges give anon/authenticated ALL
-- on new public tables, so start from nothing and add back only what's needed.
revoke all on table public.supporter_follows from public, anon, authenticated;

grant select on table public.supporter_follows to authenticated;
grant insert (followed_id) on table public.supporter_follows to authenticated;
grant delete on table public.supporter_follows to authenticated;
grant all on table public.supporter_follows to service_role;

alter table public.supporter_follows enable row level security;

create policy "Supporters can read their own follows"
  on public.supporter_follows for select
  to authenticated
  using (follower_id = (select auth.uid()));

-- The followed profile must be one the follower may see: the subquery reads
-- public.profiles under its own policy, as the follower.
create policy "Supporters with a profile can follow a public supporter"
  on public.supporter_follows for insert
  to authenticated
  with check (
    follower_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
    and exists (select 1 from public.profiles p where p.id = followed_id)
  );

create policy "Supporters can stop following"
  on public.supporter_follows for delete
  to authenticated
  using (follower_id = (select auth.uid()));

-- ── Follow, unfollow, and your own list ─────────────────────────────────
-- All three run as the caller (security invoker), so the grants and
-- policies above, and the profiles policy, apply unchanged.

-- Follow a supporter. Idempotent: returns true whether the follow is new or
-- already there. A missing account and one that isn't public raise the same
-- 'P0002' ("no public supporter"), so the answer never says which.
create function public.follow_supporter(p_profile_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to follow supporters' using errcode = '42501';
  end if;
  if p_profile_id = (select auth.uid()) then
    raise exception 'You can''t follow yourself' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid())) then
    raise exception 'Choose your name on the stands first' using errcode = '42501';
  end if;
  -- Visible to the caller = public (their own profile is ruled out above).
  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception 'No public supporter' using errcode = 'P0002';
  end if;
  insert into public.supporter_follows (followed_id) values (p_profile_id)
    on conflict (follower_id, followed_id) do nothing;
  return true;
end;
$$;

-- Stop following. Idempotent, and works for a profile that has become
-- private since (you can always let go). Returns whether a follow was removed.
create function public.unfollow_supporter(p_profile_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.supporter_follows f
    where f.follower_id = (select auth.uid()) and f.followed_id = p_profile_id;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

-- The supporters you follow, newest follow first: only public profiles (the
-- profiles policy hides the rest) and only their public columns. At most 200.
create function public.followed_supporters()
returns table (id uuid, display_name text, handle text, avatar text, followed_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.avatar, f.created_at
    from public.supporter_follows f
    join public.profiles p on p.id = f.followed_id
    where f.follower_id = (select auth.uid())
    order by f.created_at desc, p.handle
    limit 200;
$$;

-- Supabase's default privileges grant EXECUTE on new functions to everyone.
revoke all on function public.follow_supporter(uuid) from public, anon, authenticated;
revoke all on function public.unfollow_supporter(uuid) from public, anon, authenticated;
revoke all on function public.followed_supporters() from public, anon, authenticated;
grant execute on function public.follow_supporter(uuid) to authenticated, service_role;
grant execute on function public.unfollow_supporter(uuid) to authenticated, service_role;
grant execute on function public.followed_supporters() to authenticated, service_role;
