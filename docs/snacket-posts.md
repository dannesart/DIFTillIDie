# Real posts in Snacket på stan

One shared journey: a signed-in supporter publishes a post, Supabase stores it, and another visitor on another device sees it, signed in or not.

> **Status:** the migration [`20261103144226_posts.sql`](../supabase/migrations/20261103144226_posts.sql) is **applied** to the hosted project (djurgarn-dev) under that version. There, [`posts_rls.test.sql`](../supabase/tests/posts_rls.test.sql) passed 32/32 and the updated [`profiles_rls.test.sql`](../supabase/tests/profiles_rls.test.sql) passed 22/22. `posts_author_id_fkey` exists, and the grants and policies match the model below.

## What a visitor sees

Snacket på stan now has two clearly separate parts:

| Part | Content | Order | Stored |
|---|---|---|---|
| **Från läktaren**, marked "På riktigt" | Posts published by signed-in supporters | Newest first, no ranking | Supabase, visible to everyone |
| **Demo-snack**, marked "Påhittat" | The fictional supporters (each card marked "påhittad"), plus any posts this browser kept locally before | Hetast / Nyast, as before | Fictional data; local posts, reactions and comments only in this browser |

- **The composer publishes for real, or it isn't offered.**
  - Signed out, there's no text box. Instead: "Vill du snacka? Logga in…".
  - Signed in without a profile, the text box is there, but the button is "Välj läktarnamn först".
  - Signed in with a profile, "Publicera". Under the button: *"Syns för alla i Snacket på stan, även för den som inte är inloggad."*
- **Publishing states:**
  - **While publishing:** "Publicerar…", the text is read-only, and a second click does nothing.
  - **Success:** only when Supabase returns the stored row. Then the post appears at the top of "Från läktaren" and the text box clears. There's no optimistic insert.
  - **Failure:** a calm message, and **the text stays exactly as typed**. In the "Snacka om detta" dialog the text is the Story's saved draft, so it also survives closing the dialog. That dialog only shows "Ute på stan!" after confirmation.
- **Feed states:** loading placeholders (never invented content), an empty state ("Bli den första Djurgårdaren som skriver här!"), an error with "Försök igen", and "Hämta nya inlägg".
  - If a refresh fails while posts are shown, they stay with a note that they may be stale.
  - The feed also refetches when you return to the tab after more than a minute, which is handy for the two-device test.
- **Deleting your own post:** "Ta bort" → "Ja, ta bort för alla", confirmed by Supabase. Posts can't be edited.
- **Reactions and comments** on real posts arrived later; see [snacket-interactions.md](snacket-interactions.md). Follows, notifications and algorithms are still out of scope.

### Honesty decisions

1. **Old local posts are never uploaded.** Posts written before Snacket became real stay in this browser, in the demo part, labelled "🔒 bara här". Uploading them would publish things their author wrote believing they were private, and attributing guest posts to an account would be guesswork.
2. **No local-only posting any more.** With both kinds of "post", nobody could tell what was published. Reactions and comments on the fictional posts remain local, inside the labelled demo part.
3. **Fictional supporters are marked on every card**, because a real supporter can pick the same name or handle.
4. **Copy that is no longer true was changed:**
   - the banner ("Demo-snacket är påhittat");
   - the footer;
   - the account dialog ("syns för alla när du har skrivit något");
   - the Story dialog.

## Security model (enforced by the database)

| Who | posts | profiles |
|---|---|---|
| anon | read all | read `id, display_name, handle` of supporters who have published at least one post |
| authenticated | read all; **insert** `body, sport, story_id` only, with a profile, as themselves; **delete** own | the same, plus their own profile, as before |
| nobody (via the API) | update any post; choose `author_id`, `id` or `created_at`; delete someone else's | read timestamps, read e-mail (it isn't in `profiles` at all) |

- **The author can't come from the client.** `author_id` has no INSERT grant, so sending it at all, even your own ID, is "permission denied". It defaults to `auth.uid()`, and the insert policy checks `author_id = auth.uid()` again.
- **A profile is required to publish.** The insert policy checks it exists, and the foreign key to `profiles` backs that up.
- **Rules:**
  - 1–280 characters;
  - trimmed, with newlines allowed but no other control characters;
  - `sport` is `fotboll`, `hockey` or empty;
  - `story_id` is a short ID-like string.
- **Grants start from nothing** (`revoke all`), because Supabase's default privileges grant everything to `anon` and `authenticated`.
- **Data API only:** there's no backend layer of our own. RLS and grants are the whole contract.

### What changes for profiles

Posts need visible authors, which the profiles migration anticipated ("public display will get its own reviewed policy"):

- **Read access to profiles is now by column.** `authenticated` loses its table-level `SELECT` on `profiles`. `anon` and `authenticated` get `SELECT (id, display_name, handle)` only.
- **A new policy makes a profile readable once its owner has published a post.** A supporter who never posts stays private, and becomes private again after deleting all their posts.
- **Two assertions in [`profiles_rls.test.sql`](../supabase/tests/profiles_rls.test.sql) were updated** (still 22):
  - "authenticated has no table-level privileges" replaces "only SELECT at table level";
  - "Lotta cannot read Hasse's profile" selects the public columns, because `select *` is now refused outright, which is stricter.

  The previously applied hosted run reflects the old migration only. Rerun the updated file after applying posts.

### Future approval-required participation

"May publish" lives in **one place**: the insert policy `Supporters with a profile can publish as themselves`.

- **Today it checks** "has a profile".
- **For approval-required mode,** add a condition there, such as `and exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.approved)`, or a moderator-only `status` column. The client already shows the database's refusal as "Ditt konto kan inte publicera just nu".
- **Open, approval-required and closed registration** stay as described in [authentication.md](authentication.md#registration-modes-future-signing-in-is-not-permission).

### Known limits (deliberately not solved today)

- **No rate limiting or moderation.** A signed-in supporter could post often. New registrations are currently off, which limits who can. Before opening up, add a database throttle and a report/hide path for moderators.
- **Author user IDs are public** (`posts.author_id`, `profiles.id`). They're random UUIDs, not secrets, and the app needs them to know which posts are yours.
- **Search engines:** the whole site is still `noindex`.

## Code

| Part | Where |
|---|---|
| Migration | [`supabase/migrations/20261103144226_posts.sql`](../supabase/migrations/20261103144226_posts.sql) |
| Store: read, publish, delete, error messages | [`app/lib/posts.ts`](../app/lib/posts.ts), provided by [`app/plugins/auth.client.ts`](../app/plugins/auth.client.ts), used via `useCommunity()` |
| Feeds and Story counts | [`app/composables/useSnacket.ts`](../app/composables/useSnacket.ts): `realFeed` (real) and `feed` (demo) |
| UI | `SnacketSection`, `PostComposer`, `PostCard`, `StoryComposeDialog` |

- **Posts are fetched in the browser.** The server never renders them, so the CDN-cached homepage stays identical for everyone and the feed is always fresh.
- **The feed query is:** `posts.select('id, body, sport, story_id, created_at, author:profiles!posts_author_id_fkey(id, display_name, handle)')`, newest first, limit 50.

## Tests

| File | What |
|---|---|
| [`tests/posts-db.test.ts`](../tests/posts-db.test.ts) | 15 database authorization tests (the pgTAP suite runs on an empty and a non-empty database) on the real migrations in PGlite (Supabase-like roles and `auth.uid()`), and the pgTAP suite through the local shim |
| [`supabase/tests/posts_rls.test.sql`](../supabase/tests/posts_rls.test.sql) | 32 pgTAP assertions for the **real** database, in a transaction that is rolled back. Every assertion is scoped to the suite's own test users and rows, so it also runs on a database that already has real supporters and posts |
| [`tests/posts.test.ts`](../tests/posts.test.ts) | 17 store tests against a fake Supabase client |

**The database tests cover:**

- **Public reading:** anon reads posts with the author's public name, never timestamps or e-mail. A supporter who never posted stays private.
- **Authenticated publishing:** with a profile, the author and time are set by the database.
- **Anonymous writes:** publish, edit and delete are all refused.
- **No profile:** signed in without one is refused.
- **Spoofing:** setting `author_id` (anyone's), `id` or `created_at` is refused.
- **Cross-user ownership:** you can't delete someone else's post, with or without WHERE. Nobody can edit posts. The author can delete their own, and only that.
- **Account deletion:** a deleted account takes its posts with it.
- **Grants and rules:** exactly the grants listed above, and every body, sport and story rule.

**The store tests cover:**

- reading signed out;
- the empty, error and stale states;
- what is sent (never an author);
- nothing shown before confirmation;
- that failure keeps the text and the feed untouched;
- guards checked before any request;
- double-submit;
- own posts following a profile edit;
- deleting;
- the error messages.

**Mutation check:** making the insert policy, the delete policy or the profile policy `true` makes the database tests fail (2, 3 and 2 failures respectively).

**Non-empty database check:** the local runs of both pgTAP suites happen twice: once on an empty database, and once with a seeded real supporter ("Järnmannen") who has a profile and a published post. The suites must pass both times and leave that data untouched. Before the scoping fix, the seeded run failed 7 posts assertions and 1 profiles assertion.

**Browser run:** a headless run against the dev server used two isolated browser contexts and an in-memory stand-in for Supabase. No request reached the hosted project. It covered:

- **Device A, signed out:** a sign-in prompt and no text box; an old local post stays in the demo part and isn't uploaded.
- **Device A, signed in:** a failed publish keeps the text; "Publicerar…" with nothing shown early; confirmed, the post appears; a Story post with its Story attached.
- **Device B, anonymous:** sees both posts with name and handle, with no delete button and no session.
- **Deletion:** A deletes one post; B sees it gone after "Hämta nya inlägg".

## Manual two-device test plan (after applying the migration)

Use two physically separate devices or browsers: **A** (signed in, with a profile) and **B** (never signed in; a private window counts).

1. **B:** open the site. "Från läktaren" shows "Inga riktiga inlägg än" (or the existing posts). The composer shows "Logga in", not a text box.
2. **A:** sign in, check "Du på läktaren" shows your profile, write *"Hej från A! 💙 #test"*, and press **Publicera**. You see "Publicerar…", then the post at the top of "Från läktaren", with no 🔒 label and no reaction buttons.
3. **B:** press **Hämta nya inlägg**, or switch away and back after a minute. A's post appears with A's display name, handle and avatar, and no "Ta bort" button.
4. **Supabase dashboard:** the new `posts` row has A's user ID as `author_id`. Nothing else about A is exposed: try `select * from profiles` in B's browser console via the Data API and get a permission error.
5. **Failure:** on A, turn on airplane mode, write something and publish. You see "Ingen kontakt med servern. Ditt inlägg finns kvar…" and the text remains. Turn off airplane mode and publish again: it goes through once.
6. **Story:** on A, choose "Snacka om detta" on a Story and publish. "Ute på stan!" appears only after it's stored. On B, the post shows the Story card, and the Story's "💬 N inlägg" count includes it.
7. **Profile edit:** on A, change the display name. A's posts show the new name at once, and on B after fetching again.
8. **Delete:** on A, choose "Ta bort" → "Ja, ta bort för alla". On B, the post is gone after fetching again.
9. **Ownership:** sign in on B as a different supporter (an existing account, since registrations are off). B gets no "Ta bort" on A's posts, and B's own post shows B's name.
10. **Unaffected:** signed out on both devices, Stories, the match card, podcasts with the mini-player, and the demo part all work as before.

## Not verified (yet)

- **A genuine post through the hosted Data API**, including that PostgREST embeds the author via `posts_author_id_fkey`. The key exists; the embed itself is still unexercised.
- **The real two-device journey**, the plan above.
- **The exact error codes the live Data API returns** for refused inserts and expired sessions. They're mapped by code and by message; recheck once live.
