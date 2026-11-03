-- Real comments on Snacket posts.
--
-- Flat and chronological, 1–280 characters, like posts. Everyone can read
-- them; a signed-in supporter with a profile can comment as themselves and
-- delete their own comments. Nobody can edit a comment.
--
-- Access, enforced by the database:
--   anon            read comments
--   authenticated   read comments; insert (post_id, body) only, as
--                   themselves and only with a profile; delete their own
--   nobody          can edit a comment, choose its author or timestamp, or
--                   delete someone else's via the API
--
-- Deleting a post deletes its comments (on delete cascade). Commenting makes
-- your public name visible, like publishing a post does (see the profiles
-- policy at the end).

create table public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint post_comments_body_length check (char_length(body) between 1 and 280),
  constraint post_comments_body_trimmed check (body !~ '^\s' and body !~ '\s$'),
  -- Newlines are fine; other control characters are not.
  constraint post_comments_body_printable check (body !~ '[\x01-\x09\x0b-\x1f\x7f]')
);

comment on table public.post_comments is 'Public, flat comments on Snacket posts. Readable by everyone; written only by the signed-in author with a profile; deletable only by the author; never editable.';

create index post_comments_post_id_idx on public.post_comments (post_id, created_at, id);
create index post_comments_author_id_idx on public.post_comments (author_id);

-- Explicit grants. Supabase's default privileges give anon/authenticated ALL
-- on new public tables, so start from nothing and add back only what's needed.
revoke all on table public.post_comments from public, anon, authenticated;

grant select on table public.post_comments to anon, authenticated;
grant insert (post_id, body) on table public.post_comments to authenticated;
grant delete on table public.post_comments to authenticated;
grant all on table public.post_comments to service_role;

alter table public.post_comments enable row level security;

create policy "Anyone can read comments"
  on public.post_comments for select
  to anon, authenticated
  using (true);

-- Same rule as publishing a post: the one place a future approval check goes.
create policy "Supporters with a profile can comment as themselves"
  on public.post_comments for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );

create policy "Supporters can delete their own comments"
  on public.post_comments for delete
  to authenticated
  using (author_id = (select auth.uid()));

-- ── Public author names ─────────────────────────────────────────────────
-- A comment needs a visible author, so commenting makes your display name and
-- handle public, like posting. Reacting does not. Column grants are unchanged:
-- only id, display_name and handle are ever readable.
drop policy "Anyone can see the public name of supporters who have posted" on public.profiles;

create policy "Anyone can see the public name of supporters who have posted or commented"
  on public.profiles for select
  to anon, authenticated
  using (
    exists (select 1 from public.posts where posts.author_id = profiles.id)
    or exists (select 1 from public.post_comments c where c.author_id = profiles.id)
  );
