-- RECOVERY ONLY. Not a migration: run by hand in the SQL editor if the app
-- that publishes through publish_post() has to be rolled back after
-- 20261105190000_close_direct_post_inserts was applied. It restores the
-- old way of publishing exactly as 20261103144226_posts.sql defined it.
--
-- Safe with data: it changes no rows. Posts published meanwhile keep their
-- frozen Story (story_ref); publish_post() keeps working for a later
-- redeploy. Re-apply the closing migration's statements once the new app
-- is back (it isn't recorded as reverted in the migration history: the
-- supabase CLI still lists it as applied, so redo it by hand too).

begin;

alter table public.posts drop constraint if exists posts_story_frozen;

grant insert (body, sport, story_id) on table public.posts to authenticated;

create policy "Supporters with a profile can publish as themselves"
  on public.posts for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
  );

commit;
