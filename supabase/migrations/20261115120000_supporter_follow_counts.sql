-- Public follow counts (#9, v1.1): two numbers on a public supporter's place.
--
-- Product decision (2026-11-15): follower and following COUNTS may be public
-- on public supporter profiles. Individual follow relationships stay private:
-- nobody can read who follows whom, there are no follower lists, and nothing
-- here notifies anyone. public.supporter_follows, its grants, its policies and
-- the three Following v1 functions are NOT changed by this migration.
--
-- One explicit, read-only boundary: supporter_follow_counts(profile_id)
-- returns one row of two integers, or no row at all.
--
--   followers  everyone with a profile who follows this supporter (a follow
--              always has a profile at both ends: foreign keys). Their
--              identities are never returned.
--   following  the PUBLIC supporters this supporter follows: the same people
--              as their own "Du följer" list (followed_supporters()), so the
--              two never disagree.
--
-- Who gets an answer: exactly those who may read the profile under the
-- profiles policy. Public once the supporter has posted or commented
-- (to everyone, signed in or not), and always to the supporter themself.
-- For anything else, private or missing, there is no row, the same answer
-- either way, so the function can't be used to probe for accounts.
--
-- Why SECURITY DEFINER: the counts are over rows RLS hides from the caller
-- (everyone else's follows). The function therefore runs as its owner, the
-- role that owns these tables (postgres, as for every migration); table
-- owners aren't subject to RLS unless it's forced, and it isn't forced on
-- supporter_follows, posts or post_comments. It is safe because:
--   - it only reads, and only ever returns two integers;
--   - its input is a uuid used as a value, never as SQL;
--   - search_path is empty and every name is schema-qualified;
--   - it restates the profiles visibility rule (it can't rely on RLS for
--     that while bypassing it); supabase/tests/follow_counts.test.sql checks
--     that counts come back exactly when the profile is readable, so the two
--     rules can't drift apart unnoticed;
--   - EXECUTE is granted explicitly (anon, authenticated, service_role),
--     never to PUBLIC.
--
-- Accepted inference risk (product decision): with only a handful of public
-- supporters, a number can hint at a relationship. For example, "1 följare"
-- appearing just after a known supporter's visit, or a count moving while
-- someone is watching. The function never says WHO; the risk is accepted in
-- exchange for public counts. If it ever needs reducing, the options are
-- showing counts only above a minimum, or only to the owner.
--
-- Cost: two counts on indexed columns (supporter_follows_followed_id_idx for
-- followers, the primary key's follower_id prefix for following).

create function public.supporter_follow_counts(p_profile_id uuid)
returns table (followers integer, following integer)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select p.id
      from public.profiles p
     where p.id = p_profile_id
       and (
         p.id = (select auth.uid())
         or exists (select 1 from public.posts x where x.author_id = p.id)
         or exists (select 1 from public.post_comments c where c.author_id = p.id)
       )
  )
  select
    (select count(*)::integer
       from public.supporter_follows f
      where f.followed_id = v.id),
    (select count(*)::integer
       from public.supporter_follows f
      where f.follower_id = v.id
        and (
          exists (select 1 from public.posts x where x.author_id = f.followed_id)
          or exists (select 1 from public.post_comments c where c.author_id = f.followed_id)
        ))
  from visible v;
$$;

comment on function public.supporter_follow_counts(uuid) is
  'Public follow counts (#9 v1.1): followers and following for a profile the caller may see; never who follows whom.';

-- Supabase's default privileges grant EXECUTE on new functions to everyone: start from nothing.
revoke all on function public.supporter_follow_counts(uuid) from public, anon, authenticated;
grant execute on function public.supporter_follow_counts(uuid) to anon, authenticated, service_role;
