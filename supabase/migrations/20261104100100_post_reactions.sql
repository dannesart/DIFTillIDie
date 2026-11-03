-- Real reactions on Snacket posts: 💙 hjarta, 🔥 eld, ⭐ stjarna, 😭 tarar.
--
-- One active reaction per supporter per post, enforced by the primary key.
-- Who reacted is private: nobody can read other supporters' reactions, not
-- even signed in. Everyone can read the totals, through post_stats(), which
-- returns only counts.
--
-- Access, enforced by the database:
--   anon            no table access; execute post_stats()
--   authenticated   read, add, change and remove ONLY their own reactions
--                   (needs a profile); execute post_stats() and
--                   set_post_reaction()
--   nobody          can choose user_id, or touch someone else's reaction
--
-- Deleting a post deletes its reactions (on delete cascade). Reacting does
-- not make a supporter's profile public.

create table public.post_reactions (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reaction   text not null,
  created_at timestamptz not null default now(),

  primary key (post_id, user_id),
  constraint post_reactions_reaction check (reaction in ('hjarta', 'eld', 'stjarna', 'tarar'))
);

comment on table public.post_reactions is 'One reaction per supporter per post. Owner-only rows via RLS; public totals only through post_stats().';

create index post_reactions_user_id_idx on public.post_reactions (user_id);

-- Explicit grants. Supabase's default privileges give anon/authenticated ALL
-- on new public tables, so start from nothing and add back only what's needed.
revoke all on table public.post_reactions from public, anon, authenticated;

grant select on table public.post_reactions to authenticated;
grant insert (post_id, reaction) on table public.post_reactions to authenticated;
grant update (reaction) on table public.post_reactions to authenticated;
grant delete on table public.post_reactions to authenticated;
grant all on table public.post_reactions to service_role;

alter table public.post_reactions enable row level security;

create policy "Supporters can read their own reactions"
  on public.post_reactions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Same rule as posting and commenting: the one place a future approval check goes.
create policy "Supporters with a profile can react as themselves"
  on public.post_reactions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );

create policy "Supporters can change their own reactions"
  on public.post_reactions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Supporters can remove their own reactions"
  on public.post_reactions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ── Set, switch or remove your reaction in one call ─────────────────────
-- p_reaction null removes it. Runs as the caller (security invoker), so the
-- grants and policies above apply unchanged. Returns the previous reaction
-- (or null), so the client can adjust the totals exactly.
create function public.set_post_reaction(p_post_id uuid, p_reaction text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous text;
begin
  select r.reaction into previous
    from public.post_reactions r
    where r.post_id = p_post_id and r.user_id = (select auth.uid());

  if p_reaction is null then
    delete from public.post_reactions r
      where r.post_id = p_post_id and r.user_id = (select auth.uid());
  elsif previous is null then
    insert into public.post_reactions (post_id, reaction) values (p_post_id, p_reaction)
      on conflict (post_id, user_id) do update set reaction = excluded.reaction;
  elsif previous <> p_reaction then
    update public.post_reactions r set reaction = p_reaction
      where r.post_id = p_post_id and r.user_id = (select auth.uid());
  end if;

  return previous;
end;
$$;

-- ── Public totals ───────────────────────────────────────────────────────
-- Counts only: never rows or user ids. Runs as the owner (security definer)
-- because reaction rows are otherwise private. At most 100 posts per call.
create function public.post_stats(p_post_ids uuid[])
returns table (post_id uuid, hjarta integer, eld integer, stjarna integer, tarar integer, comments integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    (select count(*)::integer from public.post_reactions r where r.post_id = p.id and r.reaction = 'hjarta'),
    (select count(*)::integer from public.post_reactions r where r.post_id = p.id and r.reaction = 'eld'),
    (select count(*)::integer from public.post_reactions r where r.post_id = p.id and r.reaction = 'stjarna'),
    (select count(*)::integer from public.post_reactions r where r.post_id = p.id and r.reaction = 'tarar'),
    (select count(*)::integer from public.post_comments c where c.post_id = p.id)
  from public.posts p
  where p.id = any (p_post_ids[1:100]);
$$;

-- Supabase's default privileges grant EXECUTE on new functions to everyone.
revoke all on function public.set_post_reaction(uuid, text) from public, anon, authenticated;
revoke all on function public.post_stats(uuid[]) from public, anon, authenticated;
grant execute on function public.set_post_reaction(uuid, text) to authenticated;
grant execute on function public.post_stats(uuid[]) to anon, authenticated;
grant execute on function public.set_post_reaction(uuid, text) to service_role;
grant execute on function public.post_stats(uuid[]) to service_role;
