-- Close direct inserts into posts: publishing is publish_post() only.
--
-- Apply AFTER the app that publishes through publish_post() is deployed
-- (see "Deploying" in docs/snacket-posts.md); before that, the live app
-- would lose the ability to publish. Undo, if ever needed:
-- supabase/rollback/20261105190000_close_direct_post_inserts.down.sql.

revoke insert (body, sport, story_id) on table public.posts from authenticated;
revoke insert on table public.posts from authenticated;
drop policy "Supporters with a profile can publish as themselves" on public.posts;

-- Every new post with a Story has it frozen. NOT VALID: the posts from
-- before are left exactly as they were, and posts are never updated.
alter table public.posts
  add constraint posts_story_frozen
  check (story_id is null or story_ref is not null) not valid;
