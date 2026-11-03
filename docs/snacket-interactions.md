# Reactions and comments on real Snacket posts

Järnmannen publishes something. Mattias reacts and comments. Both of them, and anyone signed out, see the same interaction on any device.

> **Status:** both migrations are **applied** to the hosted project (djurgarn-dev), under the versions Supabase recorded:
>
> 1. [`20261103160756_post_comments.sql`](../supabase/migrations/20261103160756_post_comments.sql)
> 2. [`20261103160759_post_reactions.sql`](../supabase/migrations/20261103160759_post_reactions.sql)
>
> **Hosted results:**
> - The pgTAP suites passed: [interactions](../supabase/tests/interactions_rls.test.sql) 39/39, posts 32/32, profiles 22/22.
> - Existing posts and profiles were unchanged, and no temporary test accounts remain.
> - Anonymous `post_stats()` works on real posts, and `post_comments_author_id_fkey` exists.
>
> Any other database must apply them in that order, because `post_stats()` in the second counts comments from the first.

## What supporters see

- **Reactions:** the same chips as Demo-snack (💙 🔥 ⭐ 😭) on every real post.
  - **Counts are everyone's.** Your own reaction is highlighted.
  - **One active reaction per post.** Tapping it again removes it; tapping another replaces it.
  - **Nothing moves until Supabase confirms.** Meanwhile the chips are disabled, and a second tap does nothing.
  - **A failure** shows a short message and changes nothing.
- **Comments:** "💬 N" opens the thread, flat and oldest first.
  - **States:** "Hämtar kommentarer…", an error with "Försök igen", and "Inga kommentarer än".
  - **Sending** says "Skickar…". The comment appears only after confirmation.
  - **On failure** the message says so, and **the typed comment stays**.
  - **Your own comments** have "Ta bort" → "Ja, ta bort". There's no editing.
- **Signed out:** counts and comments are visible to everyone.
  - Tapping a reaction shows *"Vill du vara med? Logga in för att reagera och kommentera."*, never a dead button.
  - Under a thread: "Logga in för att kommentera."
  - Signed in without a profile, both prompts say "Välj ditt läktarnamn" instead.
- **Demo-snack** keeps its local-only reactions and comments. Nothing there is sent anywhere, and nothing real is mixed into it.
- **Fresh data:** totals, your highlights and any open threads reload with the feed ("Hämta nya inlägg", or returning to the tab). Signing out clears the highlights, and signing in loads the new supporter's own.

## Data model and permissions

| Table / function | anon | authenticated |
|---|---|---|
| `post_comments` | read | read; insert `post_id, body` as themselves (with a profile); delete own |
| `post_reactions` | **nothing** | read, insert `post_id, reaction`, update `reaction` and delete **their own rows only** (with a profile) |
| `post_stats(ids)`, security definer | execute | execute |
| `set_post_reaction(post, reaction \| null)`, security invoker | – | execute |

- **Uniqueness is the database's.** The primary key is `(post_id, user_id)`.
- **The reaction function** adds, switches or removes in one call, under the caller's own grants and RLS. It returns the previous reaction, so the client's totals move exactly, even if another device changed it.
- **Identity comes only from the session.** `user_id` and `author_id` default to `auth.uid()` and have no INSERT grant, so supplying them at all is refused, even with your own ID. The policies check them again.
- **Who reacted is private.** `post_reactions` is unreadable to anon, and signed-in supporters see only their own rows. Public totals come from `post_stats()`, which returns only counts (four reaction totals and the comment count) for at most 100 posts per call. It never returns rows or user IDs.
- **Profiles:** posting **or commenting** makes your `display_name` and `handle` public; reacting alone doesn't. The policy replaces the posts-only one. Column grants are unchanged (`id, display_name, handle`), and deleting your last comment and post makes you private again.
- **Cleanup:**
  - Deleting a post deletes its comments and reactions, other people's too. Referential cascades aren't subject to RLS, and that's tested.
  - Deleting an account removes its posts, comments and reactions.
- **Unchanged:** owner-only profile editing and private profile fields.
- **Future approval-required participation:** comments and reactions use the same "has a profile" rule in their insert policies as posts, so an approval check goes in those three places.

### `post_stats()` and the security advisor (intentional warnings)

Supabase's security advisor warns that `public.post_stats(uuid[])` is a **security definer function that anon and authenticated may execute**. That's intended, and it's the only such function in this project. `set_post_reaction()` is security invoker, so it isn't flagged.

**Why it needs elevated privileges.** Reaction rows are private by design: anon can't read `post_reactions` at all, and a signed-in supporter sees only their own rows. Any query running with the caller's rights therefore counts only what the caller may see: zero for anon, and your own reaction for you. A public total needs to count every row, so the counting runs as the function's owner, which RLS doesn't apply to.

**Exactly what it exposes.** Per requested post that exists:

- the number of 💙, 🔥, ⭐ and 😭 reactions;
- the number of comments.

That's all. No user IDs, no rows, no timestamps, nothing about posts that don't exist. Comments and posts are public anyway, so the comment count adds nothing new. What *is* new is the reaction totals, which is the purpose.

- **Inherent, accepted:** a total of 1 reveals that *someone* reacted, and someone watching a count change at the moment a known person acts could guess it was them. Any public count has this.

**Why it's bounded:**

- **Fixed output.** It returns six columns per post. It takes no column names, filters or SQL from the caller, and runs no dynamic SQL, so there's nothing to inject and no way to widen it.
- **Fixed lookup path.** `set search_path = ''` and fully qualified table names mean it can't be redirected to look-alike objects.
- **At most 100 post IDs per call.** Extra IDs are ignored (`p_post_ids[1:100]`). Each post costs five indexed counts: `post_reactions`'s primary key starts with `post_id`, and `post_comments` has a `(post_id, …)` index.
- **Read-only.** It's `stable`, writes nothing, and only reads `posts`, `post_reactions` and `post_comments`.
- **Explicit execute grants.** Supabase's default "everyone may execute" is revoked first; then anon and authenticated (and service_role) are granted execute explicitly.

**Alternatives considered:**

| Approach | Why not |
|---|---|
| A view or function with the caller's rights (security invoker) | Counts only rows the caller can see: zero for anon. |
| Make reaction rows readable but withhold the `user_id` column | Column grants are per role, not per row. Signed-in supporters need `user_id` to find their own reaction, so they'd see everyone's. |
| PostgREST aggregates (`select=…,count()`) | Off by default on Supabase, and they'd still need readable rows. Counting rows in the browser downloads every reaction, unbounded. |
| Counter columns on `posts`, kept up to date by triggers | Exposes the same totals with one request fewer, but the trigger must also run with elevated privileges, since users may not update posts. It adds drift risk, a reconciliation job and row-lock contention on popular posts. Not simpler. |
| A materialized view of totals | Stale between refreshes, needs a scheduled job, and an exposed materialized view has its own advisor warning. |

**Conclusion:** a small, bounded, counts-only security-definer function is the simplest design that keeps *who* reacted private while showing totals to everyone. If the feed ever needs the totals in the same request as the posts, the counter columns are the upgrade path. Keep the warnings as acknowledged, and recheck them if `post_stats()` changes.

### Assumptions challenged

- **"Anyone can read the reactions table" would leak who reacted.** So the table is owner-only and totals go through a counting function. A post with exactly one reaction still reveals *that* someone reacted, but not who.
- **The post author can't delete other people's comments.** That's moderation, and it's out of scope. Only the comment's author can delete it.
- **Comments and reactions need a profile, not just a session.** Same as posting: a signed-in supporter who hasn't chosen a name can't appear anywhere.
- **Commenting publishes your name, as the task asked.** The comment form doesn't warn about this separately. The account dialog already says your name becomes visible when you write something.

## Known limits

- **No rate limiting or moderation.** Registrations are closed. Before opening them, add database throttles for posts, comments and reactions, plus a report/hide path.
- **No real-time updates:** other people's interactions show up on refresh or when you return to the tab.
- **Each thread shows at most 200 comments**, oldest first, and says so ("Visar de 200 äldsta av N kommentarer"). The 💬 total always comes from `post_stats()`, never from the loaded list.

## Tests

| File | What |
|---|---|
| [`tests/interactions-db.test.ts`](../tests/interactions-db.test.ts) | 21 database tests on the real migrations in PGlite, including the pgTAP suite on an empty database and on one with real supporters, posts, comments and reactions |
| [`supabase/tests/interactions_rls.test.sql`](../supabase/tests/interactions_rls.test.sql) | 39 pgTAP assertions for the **real** database, rolled back, and scoped to its own test users |
| [`tests/interactions.test.ts`](../tests/interactions.test.ts) | 17 store tests against a fake client |

**The database tests cover:**

- **Reactions:** add, switch, remove, and the previous value; uniqueness against a direct second insert; totals readable by anon, with reaction rows unreadable; only your own rows visible signed in.
- **Profile visibility:** reacting doesn't publish your profile; commenting does; deleting the comment reverts it.
- **Who may write:** anonymous writes are refused everywhere, and so is anyone signed in without a profile.
- **Spoofing:** supplying `user_id`, `author_id`, `id` or `created_at` is refused.
- **Cross-user attacks:** updating or deleting someone else's reaction or comment, with or without WHERE, including by the post's author. Nobody can edit comments.
- **Rules:** comment body limits, unknown reactions, unknown posts, and the `post_stats` cap.
- **Cascades:** a post's deletion takes everyone's comments and reactions with it, and so does an account's.
- **Grants:** exact table, column and function privileges, including "PUBLIC may not execute".

**Mutation check:** each of these makes the database tests fail:

- reaction rows readable by everyone;
- any comment deletable by anyone;
- `set_post_reaction` as security definer;
- a profile policy that publishes reactors.

**Browser run:** three isolated browser contexts against the dev server, with an in-memory stand-in for Supabase that takes identity only from each request's token. No writes or sign-ins reached the hosted project. One unrouted page made anonymous reads of the hosted feed; `post_stats` returned 404 there, as expected before the migration. It covered:

- **Anonymous (C):** saw zero counts, got the invitation on tap, and made no writes.
- **Mattias (A):** 💙, then switched to 🔥; a failed comment kept its text, the retry succeeded, and the count went up.
- **Järnmannen (B):** saw 🔥 1 and Mattias's comment, with no delete button on it, and added 💙.
- **Anonymous again (C):** saw 💙 1 · 🔥 1 and the comment, and got "Logga in för att kommentera".
- **Mattias (A):** saw Järnmannen's 💙, removed his 🔥 by tapping it again, and deleted his comment.

## Manual test plan (two devices, after applying the migrations)

**A** = Mattias, signed in with a profile. **B** = Järnmannen, signed in. **C** = a private window, signed out.

1. **B** publishes *"Hej läktaren!"*.
2. **A** presses "Hämta nya inlägg" and taps 💙. The count goes 0 → 1 and 💙 is highlighted.
3. **A** taps 🔥. 💙 drops to 0 and 🔥 becomes 1, highlighted. Then tap 🔥 again: back to 0, nothing highlighted. Finish by tapping 💙.
4. **A** opens 💬 and writes *"Vilken kväll!"*. It appears with Mattias's name, handle and avatar, and 💬 shows 1.
5. **Failure:** on A, turn on airplane mode and send a comment. A message appears and the text stays. Turn airplane mode off and resend: it goes through once.
6. **B** fetches again. 💙 1 is not highlighted on B, the comment is visible, and B has no "Ta bort" on it.
7. **C** sees the same counts and the comment.
   - Tapping a reaction shows the sign-in invitation.
   - In the browser console, a Data API request for `post_reactions` is refused.
   - `rpc/post_stats` returns counts only.
8. **A** deletes the comment ("Ta bort" → "Ja, ta bort"). It disappears on C after fetching again. If A has no posts, A's profile is no longer readable by C.
9. **B** deletes the post. In the dashboard, its comments and reactions are gone too.
10. **Unaffected:** Demo-snack reactions and comments, Stories, podcasts and the match card all work signed out and in.

## Not verified (yet)

- **From the browser, through the live Data API:**
  - a real reaction via `set_post_reaction`, and a real comment with its embedded author;
  - which error codes it returns for refused writes.
- **The real multi-device journey**, the plan above.
