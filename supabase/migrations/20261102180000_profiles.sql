-- Supporter profiles for Djurgår'n tills jag dör.
--
-- A profile holds only what the supporter chooses to be called here: a display
-- name and a unique handle. Nothing is copied from Google (no names, e-mail
-- addresses or avatars), and nothing is created automatically on sign-up —
-- the supporter creates their profile themselves.
--
-- Access, enforced by the database:
--   anon            no access at all
--   authenticated   read, create and update ONLY their own row
--                   (id is fixed to auth.uid(); id and timestamps can't be written)
--   nobody          can delete via the API (account deletion is out of scope)
--
-- Profiles are deliberately not readable by other supporters yet. When real
-- Snacket posts arrive, public display will get its own reviewed policy/view.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  handle       text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_handle_unique unique (handle),
  -- Lowercase only, so uniqueness is case-insensitive by construction.
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_handle_not_reserved check (handle <> all (array[
    'admin', 'administrator', 'moderator', 'support', 'system', 'official', 'officiell',
    'djurgarden', 'djurgarn', 'dif', 'difotboll', 'difhockey', 'klubben', 'snacket',
    'null', 'undefined'
  ])),
  constraint profiles_display_name_trimmed check (display_name = btrim(display_name)),
  constraint profiles_display_name_length check (char_length(display_name) between 2 and 40),
  constraint profiles_display_name_printable check (display_name !~ '[[:cntrl:]]')
);

comment on table public.profiles is 'Supporter-chosen display name and handle. Owner-only access via RLS; no data copied from the identity provider.';

-- Keep updated_at honest without trusting the client.
create function public.profiles_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.profiles_touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.profiles_touch_updated_at();

-- Explicit grants. Supabase's default privileges give anon/authenticated ALL
-- on new public tables, so start from nothing and add back only what's needed.
revoke all on table public.profiles from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant insert (id, display_name, handle) on table public.profiles to authenticated;
grant update (display_name, handle) on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

alter table public.profiles enable row level security;

create policy "Supporters can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Supporters can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Supporters can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
