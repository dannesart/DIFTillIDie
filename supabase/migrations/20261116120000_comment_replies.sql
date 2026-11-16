-- Direct replies to comments on Snacket posts.
--
-- A comment may answer another comment on the same post. The relationship is
-- data the supporter chose, stored as a reference — never inferred from an
-- @mention in the text or from timestamps. The thread itself stays flat and
-- chronological: nothing here changes how comments are ordered or paged.
--
--   parent_comment_id   the comment being answered; null for an ordinary
--                       comment, and null again once that comment is deleted
--   is_reply            whether the comment was published as a reply. Set by
--                       the database at insert and never changed, so a reply
--                       whose parent is gone still says it was a reply (to a
--                       comment that no longer exists), without keeping
--                       anything of the deleted comment or its author.
--
-- Integrity, enforced by the database:
--   - the parent exists, on the same post, when the reply is published
--     (composite foreign key; it also locks the parent against a concurrent
--     delete until the reply is committed or refused)
--   - a comment cannot answer itself, and a reply's parent must already exist
--     before it: with nothing editable, reply chains can never form a cycle
--   - once published, a reply is never moved to another comment; the only
--     change ever made is clearing the reference when the parent is deleted
--   - is_reply is the database's, not the client's
--
-- Access is unchanged except that supporters may also supply
-- parent_comment_id when they comment. Still no update permission at all.
--
-- Requires PostgreSQL 15+ for ON DELETE SET NULL (column list).
-- Existing comments: parent_comment_id null, is_reply false. Adding the
-- columns with a constant default doesn't rewrite the table.

alter table public.post_comments
  add column parent_comment_id uuid,
  add column is_reply boolean not null default false;

comment on column public.post_comments.parent_comment_id is 'The comment on the same post that this one answers. Null for an ordinary comment, and set to null when the answered comment is deleted.';
comment on column public.post_comments.is_reply is 'True when published as a reply. Set by the database at insert and never changed, so it stays true after the answered comment is deleted.';

-- The target of the composite foreign key below: (id) is already unique, so
-- this adds no new restriction, only something (parent, post) can reference.
alter table public.post_comments
  add constraint post_comments_id_post_id_key unique (id, post_id);

-- The parent must be a comment on the same post. MATCH SIMPLE (the default):
-- with no parent, nothing is checked. Deleting the parent clears only
-- parent_comment_id (post_id is not null and must stay).
alter table public.post_comments
  add constraint post_comments_parent_fkey
    foreign key (parent_comment_id, post_id)
    references public.post_comments (id, post_id)
    on delete set null (parent_comment_id);

alter table public.post_comments
  add constraint post_comments_not_own_parent check (parent_comment_id <> id),
  add constraint post_comments_parent_means_reply check (parent_comment_id is null or is_reply);

-- Deleting a comment looks up its replies (to clear their reference); so will
-- finding a comment's replies. Only replies are indexed.
create index post_comments_parent_comment_id_idx
  on public.post_comments (parent_comment_id)
  where parent_comment_id is not null;

-- ── is_reply and the immutable relationship ─────────────────────────────
-- Insert: is_reply follows from the parent, whatever was sent; the parent
-- must already be there, on this post (before this row — so not this row
-- itself, and not a row inserted later in the same statement). The foreign
-- key stays the guarantee under concurrency; this check gives the same error
-- code (23503) earlier and closes the multi-row-insert cycle the foreign key
-- alone would allow to roles that can choose ids.
--
-- Update (nobody but the database itself may update comments): is_reply never
-- changes, and parent_comment_id may only become null, and only once its
-- comment is gone — which is exactly what the foreign key's ON DELETE does.
create function public.post_comments_reply_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.is_reply := new.parent_comment_id is not null;
    if new.parent_comment_id is not null then
      if new.parent_comment_id = new.id then
        raise exception 'a comment cannot answer itself'
          using errcode = '23514', constraint = 'post_comments_not_own_parent';
      end if;
      if not exists (select 1 from public.post_comments p where p.id = new.parent_comment_id and p.post_id = new.post_id) then
        raise exception 'the comment being answered does not exist on this post'
          using errcode = '23503', constraint = 'post_comments_parent_fkey';
      end if;
    end if;
    return new;
  end if;

  if new.is_reply is distinct from old.is_reply then
    raise exception 'whether a comment is a reply cannot change'
      using errcode = '23514', constraint = 'post_comments_parent_means_reply';
  end if;
  if new.parent_comment_id is distinct from old.parent_comment_id
     and (new.parent_comment_id is not null
          or exists (select 1 from public.post_comments p where p.id = old.parent_comment_id)) then
    raise exception 'a reply cannot be moved to another comment'
      using errcode = '23514', constraint = 'post_comments_parent_fkey';
  end if;
  return new;
end;
$$;

revoke execute on function public.post_comments_reply_guard() from public, anon, authenticated;

create trigger post_comments_reply_on_insert
  before insert on public.post_comments
  for each row execute function public.post_comments_reply_guard();

create trigger post_comments_reply_on_update
  before update of parent_comment_id, is_reply on public.post_comments
  for each row execute function public.post_comments_reply_guard();

-- ── Access ───────────────────────────────────────────────────────────────
-- Supporters may now name the comment they answer. Still not id, author_id,
-- created_at or is_reply, and still no update. The insert policy (as
-- yourself, with a profile) and owner-only delete are unchanged.
grant insert (parent_comment_id) on table public.post_comments to authenticated;
