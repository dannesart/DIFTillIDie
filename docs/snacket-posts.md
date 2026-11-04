# Real posts in Snacket på stan

One shared journey: a signed-in supporter publishes a post, Supabase stores it, and another visitor on another device sees it, signed in or not.

> **Status:** the migration [`20261103144226_posts.sql`](../supabase/migrations/20261103144226_posts.sql) is **applied** to the hosted project (djurgarn-dev) under that version. There, [`posts_rls.test.sql`](../supabase/tests/posts_rls.test.sql) passed 32/32 and the updated [`profiles_rls.test.sql`](../supabase/tests/profiles_rls.test.sql) passed 22/22. `posts_author_id_fkey` exists, and the grants and policies match the model below.

## What a visitor sees

Snacket på stan is one feed: posts published by signed-in supporters, stored in Supabase, visible to everyone. It shows **Nyast** (newest first) by default, or **Hetast** ([below](#hetast--nyast)). Hashtags, filters and Story counts come only from these posts. (Until [Mission #14](#retired-demo-snack) a separate, labelled Demo-snack with fictional supporters sat below it.)

- **The composer publishes for real, or it isn't offered.**
  - Signed out, there's no text box. Instead: "Vill du snacka? Logga in…".
  - Signed in without a profile, the text box is there, but the button is "Välj läktarnamn först".
  - Signed in with a profile, "Publicera". Under the button: *"Syns för alla i Snacket på stan, även för den som inte är inloggad."*
- **Publishing states:**
  - **While publishing:** "Publicerar…", the text is read-only, and a second click does nothing.
  - **Success:** only when Supabase returns the stored row. Then the composer clears and collapses, the feed goes back to Nyast with any filters cleared, and the page scrolls to the new post once it has rendered, stopping below the sticky header. There's no optimistic insert.
  - **Failure:** a calm message, and **the text stays exactly as typed**. In the "Snacka om detta" dialog the text is the Story's saved draft, so it also survives closing the dialog. That dialog only shows "Ute på stan!" after confirmation.
- **Feed states:** loading placeholders (never invented content), an empty state ("Bli den första Djurgårdaren som skriver här!"), an error with "Försök igen", and "Hämta nya inlägg".
  - If a refresh fails while posts are shown, they stay with a note that they may be stale.
  - The feed also refetches when you return to the tab after more than a minute, which is handy for the two-device test.
- **Deleting your own post:** "Ta bort" → "Ja, ta bort för alla", confirmed by Supabase. Posts can't be edited.
- **Reactions and comments** on real posts arrived later; see [snacket-interactions.md](snacket-interactions.md). Follows, notifications and any ranking beyond Hetast are still out of scope.

### Hetast / Nyast

The familiar two-tab control sits above the feed. **Nyast** is the default: newest first, exactly as Supabase returns them.

**Hetast** is a simple ranking in [`app/lib/feedSort.ts`](../app/lib/feedSort.ts). It's computed in the browser from the totals `post_stats()` already returns, with no database changes:

    heat = (reactions + 2 × comments + 1) / (hours since posted + 2) ^ 1.4

- **Only the loaded posts.** It ranks the newest 50 posts the feed loads, and the note under the tabs says so ("Bland de N senaste inläggen…"). It never implies all-time popularity.
- **Filters first.** The sport, #tag and Story filters apply, then the order.
- **No engagement means newest first.** The formula reduces to that, ties fall back to it, and the note says "Inga reaktioner eller kommentarer än – nyast först."
- **No totals, no ranking.** While `post_stats()` is loading, or if it failed, Hetast stays newest first and says why.
- **No jumping.** The order is a snapshot. It's taken when Hetast is chosen and when Supabase delivers fresh totals (`statsLoadedAt`, after posts load or refresh).
  - Your own reaction or comment updates the counts in place but never re-sorts, so a post doesn't move away from under you.
  - Posts newer than the snapshot go first.
- **Publishing** from the main composer switches back to Nyast and reveals the new post. Posting from a Story's dialog leaves the feed as it is.

### Attaching a Story

A post can be about one Story. It's stored as the post's `story_id`, which is a structured reference, never parsed from the text. The old "Koppla till en Story…" dropdown is gone. There are now two ways to attach a Story, both searching only the Stories already loaded on the page ([`app/lib/storyLookup.ts`](../app/lib/storyLookup.ts)). Nothing is fetched and nothing is invented. If nothing matches, it says so.

- **📎 Bifoga Story** opens a search field. It lists the latest Stories when empty, and works before a word is written. Arrow keys and Enter, or a tap, attach a Story. Escape closes the search and returns focus to the button.
- **`#` in the post** lists the latest Stories under the text box straight away, showing each outlet's own headline, outlet, publisher and age. Typing after it (`#derb…`) narrows the list. The suggestions follow the caret: they reopen when you click or arrow back into a `#word`, and the text box listens to `input`, `click`, caret keys and `selectionchange`, so phone keyboards that insert text without key events work too.
  - **It stays an ordinary hashtag unless you choose a Story.** Keep typing and the suggestions disappear. Enter is still a new line unless the arrow keys picked a suggestion first. If nothing matches, it says "Det blir en vanlig hashtagg."
  - **Choosing** (arrow keys + Enter, or a tap) removes the `#text`, keeps the rest of the draft, puts the caret where the word was, and shows the Story as the removable "Om: …" chip.
  - **Escape** hides the suggestions for that word and keeps the text and the composer.
  - **When suggestions are off:** in a Story's own "Snacka om detta" dialog, which already has its Story, and while a Story is attached. One Story per post, so hashtags are just hashtags there. A Story counts as attached when it was attached automatically too: browsing one Story's posts ("Snackas om i N inlägg") attaches that Story in the composer, as before. ✕ on the chip turns the suggestions back on.
- **Matching:** the start of each word in the original headlines, outlets and publishers, ignoring case and accents ("malmo" finds "Malmö"). A match in the lead headline ranks first.
- **Accessibility and touch:**
  - Focus stays in the text field or search field, which point at the suggestion you're on (`aria-activedescendant`).
  - A polite live region announces the number of matches, the attachment, and that the suggestions closed.
  - Suggestions don't take focus when tapped, so the phone keyboard stays up. The search field uses 16px text, so iOS doesn't zoom.

**Known limitation: a Story reference can outlive its Story.** `story_id` is only an id such as `story-<article id>`. The headline, outlet and link are not stored with the post: they come from the live RSS feeds, which keep only each outlet's latest items, and no database. So once every article of a Story has left the feeds, typically within days:

- the post keeps its `story_id` but loses its "Om: …" card;
- it drops out of that Story's count and filter;
- nothing tells the reader it was ever about a Story.

`storyAnswersTo()` already covers Stories merging or changing their lead article. It can't bring back articles that are gone. Fixing this would mean storing a small snapshot (outlet, headline, URL) with the post. That needs a migration and a decision about trusting client-supplied headlines, so it isn't part of this change.

### Retired: Demo-snack

Mission #14 removed the fictional Snacket. That meant removing:

- the invented supporters and their posts;
- their seeded reactions and comments;
- the Hetast/Nyast ranking of fictional posts (since restored for real posts, above);
- the guest's local name;
- every "påhittad" or "demo" label, now that nothing is invented.

The banner became a short **Pilot** banner: "Allt här är på riktigt…".

**Old browser-local posts.** Some visitors wrote posts before real publishing existed. Those were only ever saved in their own browser, under `djurgarn:snacket:v1` (or `…:account:<id>`). They're now **dormant**:

- **Not shown anywhere.** A read-only "Bara på den här enheten" viewer was tried in this mission and then removed: Snacket shows only real Supabase content.
- **Never uploaded, migrated or attributed.** Uploading would publish words written as private, and attributing guest posts to an account would be guesswork.
- **Never deleted.** No code reads, rewrites or removes those keys. They stay in the browser until its owner clears site data.

**Tradeoffs:**

- **A visitor who wrote local posts back then can no longer see them in the app.** The data is still in their browser's storage. Bringing back a viewer later would be a UI change only.
- **The same goes for local reactions and comments on the retired fictional posts, and the old guest name:** they're dormant in storage, unused.
- **Clearing browser data removes them,** as it always would have. They were never anywhere else.

### Honesty decisions (Mission #12)

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
| Feed, filters and Story counts | [`app/composables/useSnacket.ts`](../app/composables/useSnacket.ts): `feed` (filtered) and `all` |
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
10. **Unaffected:** signed out on both devices, Stories, the match card and podcasts with the mini-player all work as before.

## Not verified (yet)

- **A genuine post through the hosted Data API**, including that PostgREST embeds the author via `posts_author_id_fkey`. The key exists; the embed itself is still unexercised.
- **The real two-device journey**, the plan above.
- **The exact error codes the live Data API returns** for refused inserts and expired sessions. They're mapped by code and by message; recheck once live.
