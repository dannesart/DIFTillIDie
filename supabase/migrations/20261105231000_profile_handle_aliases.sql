-- Supporter pages are addressed by handle: /laktaren/<handle>.
--
-- The user id stays the identity: posts, ownership and every permission use
-- it. A handle is only a public address, unique and changeable. When it
-- changes, the old one is kept here as an alias, so old links still lead to
-- the same supporter.
--
--   No impersonation: a retired handle stays reserved for the supporter who
--     used it. Nobody else can take it (23505, like any taken handle), so an
--     old link can never start pointing at someone else. Its owner can take
--     it back, which simply makes it current again.
--   No hoarding: each supporter keeps their 5 most recent retired handles.
--     Older ones are released; links to them then lead nowhere (or, once
--     someone else takes the handle, to that supporter).
--   No leaks: an alias is readable exactly when its profile is (the policy
--     asks profiles, whose own policy decides): by everyone once the
--     supporter has posted or commented, otherwise only by themselves.
--   Written only by the database, from the trigger on profiles: there are no
--     insert, update or delete grants.

create table public.profile_handle_aliases (
  handle     text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  retired_at timestamptz not null default clock_timestamp(),

  constraint profile_handle_aliases_format check (handle ~ '^[a-z0-9_]{3,20}$')
);

comment on table public.profile_handle_aliases is 'Former handles, so old /laktaren/<handle> links still resolve. Reserved for their supporter; readable exactly when the profile is.';

create index profile_handle_aliases_profile_idx on public.profile_handle_aliases (profile_id, retired_at desc);

revoke all on table public.profile_handle_aliases from public, anon, authenticated;
grant select (handle, profile_id) on table public.profile_handle_aliases to anon, authenticated;
grant all on table public.profile_handle_aliases to service_role;

alter table public.profile_handle_aliases enable row level security;

-- Visible exactly when the profile is: the subquery runs under profiles' own policies.
create policy "Aliases are visible exactly when their profile is"
  on public.profile_handle_aliases for select
  to anon, authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_handle_aliases.profile_id));

-- ── Keeping aliases, and keeping them reserved ──────────────────────────
-- SECURITY DEFINER: it must see every alias (not just the visible ones) to
-- refuse a reserved handle, and write aliases no API role may write. It only
-- ever acts on the row being saved, whose ownership RLS has already checked.
create function public.profiles_handle_aliases()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profile_handle_aliases a where a.handle = new.handle and a.profile_id <> new.id) then
    raise exception 'handle % is reserved', new.handle using errcode = '23505';
  end if;

  if tg_op = 'UPDATE' and new.handle <> old.handle then
    -- Taking back one of your own old handles makes it current again.
    delete from public.profile_handle_aliases where handle = new.handle;
    insert into public.profile_handle_aliases (handle, profile_id) values (old.handle, old.id)
      on conflict (handle) do update set retired_at = clock_timestamp();
    -- Keep the 5 most recent.
    delete from public.profile_handle_aliases
      where profile_id = new.id
        and handle not in (
          select handle from public.profile_handle_aliases where profile_id = new.id order by retired_at desc, handle limit 5
        );
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_handle_aliases() from public, anon, authenticated;

-- BEFORE: a refused handle stops the write. (The alias rows it writes are
-- part of the same statement, so a failing update writes none.)
create trigger profiles_handle_aliases
  before insert or update of handle on public.profiles
  for each row execute function public.profiles_handle_aliases();
