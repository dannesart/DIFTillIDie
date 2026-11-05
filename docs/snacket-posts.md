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
- **`#` in the post** is a hashtag first. A bare `#` offers the three latest Stories straight away (three at most, so the popup never scrolls), showing each outlet's own headline, outlet, publisher and age. Typing after it (`#derb…`) narrows the list. The suggestions follow the caret: they reopen when you click or arrow back into a `#word`, and the text box listens to `input`, `click`, caret keys and `selectionchange`, so phone keyboards that insert text without key events work too.
  - **It stays an ordinary hashtag unless you choose a Story.** Keep typing and the suggestions disappear. Enter is still a new line unless the arrow keys picked a suggestion first. When nothing matches, the popup quietly goes away and nothing unrelated fills it; with no Stories loaded there is no popup at all.
  - **The popup floats at the `#`.** It isn't a box in the page, so nothing below moves when it opens or closes.
    - **Finding the `#`:** a hidden copy of the textarea (same width, font and wrapping; `app/lib/caretPopup.ts`) shows where the `#` lands, including on later lines and after the textarea has scrolled.
    - **Placement:** below that line, or above it when there isn't room. It stays inside the visual viewport, which counts a phone keyboard, and follows page scrolling, resizing and the keyboard. It hides while the `#` is scrolled out of the textarea.
    - **Teleported to `#teleports`:** the composer card's `backdrop-filter` would otherwise make `position: fixed` relative to the card.
    - **Focus:** pressing in it never takes focus from the textarea.
  - **Choosing** (arrow keys + Enter, or a tap) removes the `#text`, keeps the rest of the draft, puts the caret where the word was, and shows the Story as the removable "Om: …" chip.
  - **Escape** hides the suggestions for that word and keeps the text and the composer.
  - **When suggestions are off:** in a Story's own "Snacka om detta" dialog, which already has its Story, and while a Story is attached. One Story per post, so hashtags are just hashtags there. A Story counts as attached when it was attached automatically too: browsing one Story's posts ("Snackas om i N inlägg") attaches that Story in the composer, as before. ✕ on the chip turns the suggestions back on.
- **Matching:** the start of each word in the original headlines, outlets and publishers, ignoring case and accents ("malmo" finds "Malmö"). A match in the lead headline ranks first.
- **Accessibility and touch:**
  - Focus stays in the text field or search field, which point at the suggestion you're on (`aria-activedescendant`).
  - A polite live region announces the number of matches, the attachment, and that the suggestions closed.
  - Suggestions don't take focus when tapped, so the phone keyboard stays up. The search field uses 16px text, so iOS doesn't zoom.

### Durable Story references

A post keeps the Story it's about for good, frozen when it was published. The RSS feeds only hold each outlet's latest items, so `story_id` alone stops resolving within days. Migration [`20261105183401_post_story_refs.sql`](../supabase/migrations/20261105183401_post_story_refs.sql).

**What's kept: `posts.story_ref` (jsonb).**
- It holds exactly the sources the supporter attached (up to 20), with the lead marked.
- Per source: the outlet's own headline, outlet, publisher, the feed's URL (unchanged), the published date, and `capturedAt`, when our server read it from the feed.
- Its durable identity is `key`, the SHA-256 of the canonical URL. The id and legacy id are kept too.
- No article text: no teasers, nothing from the article body.
- It's labelled "Ur flödet från …, \<date\>", i.e. as captured from the feed. It isn't necessarily the article's first version.

**Why it can be trusted: signed captures.**
- Whenever the server builds Stories ([`server/lib/capture.ts`](../server/lib/capture.ts), called from `getNews()`), each Story gets `capture`: the FrozenStory JSON plus an HMAC-SHA256 of it.
- The browser sends that exact text and signature to `publish_post()`.
- The database looks up the key `story_capture_key:<kid>` in Supabase Vault and recomputes the HMAC.
- Anything edited, re-serialised, unsigned, signed with an unknown key or malformed is refused with `22023`.
- The browser can choose *which* signed Story to attach, but can't change a word of it.

**Atomic.**
- Publishing is `publish_post()` only, one function and one transaction. Direct inserts into `posts` are closed by a second migration, [`20261105201518_close_direct_post_inserts.sql`](../supabase/migrations/20261105201518_close_direct_post_inserts.sql), applied after the app is deployed (see [Deploying](#deploying-frozen-story-references)).
- The post and its frozen Story are written together or not at all. A refused capture publishes nothing, and the composer keeps the text and says so.
- A Story is never silently dropped from a post.

**Frozen means frozen.**
- Groupings change: a Story can gain or lose sources later. The post keeps what was attached.
- Posts can't be updated, and the frozen Story can't be written directly.

**No background job.**
- Captures are made whenever `/api/news` is built, so a CDN-cached response still carries valid ones. There is no ingestion that has to have run.
- Without a key, the server makes no captures and Stories can't be attached; publishing without one still works. The same goes when Vault has no matching key: the database refuses, and the composer says why.

**Keys.**
- The server side is `NUXT_STORY_CAPTURE_KEY_ID` and `NUXT_STORY_CAPTURE_KEY`: `runtimeConfig.storyCapture`, server-only and never under `public`.
- The database side is `select vault.create_secret('<same secret>', 'story_capture_key:<same id>')`.
- Rotating or revoking a key: see [Signing keys](#signing-keys).

**Posts from before 2026-11-05.**
- These have a bare `story_id` and no `story_ref`, and nothing is invented for them.
- While their Story is in the feeds, the card shows the live Story.
- Afterwards it says: "Inlägget handlade om en Story som inte längre finns i nyhetsflödena. Den sparades inte när inlägget skrevs."
- **Legacy ids are 32-bit hashes**, which can collide. `findStory()` only resolves a legacy id when exactly one live Story answers to it; otherwise nothing is shown.
- Articles now have 96-bit ids, and `legacyId` keeps the old one for these posts.

**When an original link stops working.**
- The card still shows the headline, outlet, publisher and date as captured, which is enough to find the article.
- We don't mirror articles, rewrite URLs, check links or link to third-party archives.

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
| authenticated | read all; **publish** only via `publish_post(body, sport, story capture, signature)`, with a profile, as themselves (no direct insert since 2026-11-05); **delete** own | the same, plus their own profile, as before |
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
- **The feed query is:** `posts.select('id, body, sport, story_id, story_ref, created_at, author:profiles!posts_author_id_fkey(id, display_name, handle)')`, newest first, limit 50. On a database without `story_ref` yet (`42703`), it retries without it.
- **Publishing is:** `rpc('publish_post', { p_body, p_sport, p_story, p_story_sig }).select(…)`, with the same columns.

## Tests

| File | What |
|---|---|
| [`tests/story-refs-db.test.ts`](../tests/story-refs-db.test.ts) | Frozen Story references in PGlite (with pgcrypto and a Vault stand-in): signed captures, forged ones (edited, re-serialised, unsigned, unknown key, malformed), changed groupings, no key, atomicity, posts from before the migration, and [`story_refs_rls.test.sql`](../supabase/tests/story_refs_rls.test.sql) on an empty and a non-empty database |
| [`tests/story-capture.test.ts`](../tests/story-capture.test.ts) | What the server signs (no article text), article identity, legacy ids and their collisions |
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

## Deploying frozen Story references

The change is two migrations around one app deploy. Applying the closing migration before the new app is live would stop the live app from publishing; the order below never does.

| Step | What | Who publishes how |
|---|---|---|
| 0 | The repository contains `20261105183401` and `20261105201518`, not yet deployed | old app: direct insert |
| 1 | Apply `20261105183401_post_story_refs.sql` only (adds the column, check and `publish_post()`). **Done on `djurgarn-dev`, 2026-11-05, recorded as `20261105183401_post_story_refs`**: the Story-reference tests 15/15 and the posts, interactions and profiles tests 93/93 passed there; direct inserts and signed `publish_post()` both work; no test data left | old app: direct insert, still works |
| 2 | Choose a key id and a secret (`openssl rand -hex 32`). Put it in **Vault**: `select vault.create_secret('<secret>', 'story_capture_key:<id>')`; and in **Netlify** (server only, never `NUXT_PUBLIC_`): `NUXT_STORY_CAPTURE_KEY_ID`, `NUXT_STORY_CAPTURE_KEY`. **Done: key id `v1`**, in Vault and in Netlify (Functions scope); a real signed post ("Snyggt!") was accepted by `publish_post()` | old app |
| 3 | Deploy the new app (it uses `publish_post()`; a new deploy also clears the CDN's cached pages and `/api/news`). Check that `/api/news` Stories carry `capture`. **Done: `main` at `aacc230`, deployed to diftillidie.netlify.app**; all 19 live Stories signed with `v1`, and their signatures verify against the same key; the frozen "Snyggt!" attachment renders | new app: `publish_post()`; old tabs until reloaded: direct insert, still works |
| 4 | Run `npm run test:acceptance` against it, except the direct-insert check, which passes only after step 5. **Not run**: no test-supporter session was available | new app |
| 5 | Apply `20261105201518_close_direct_post_inserts.sql`, then run `supabase/tests/*.test.sql` and `npm run test:acceptance` again (all green). **Done on `djurgarn-dev`, 2026-11-05, recorded as `20261105201518_close_direct_post_inserts`**: 110/110 hosted security assertions passed; direct inserts closed, `publish_post()` available to supporters; all 6 existing posts and the frozen Story kept; no test data left. `npm run test:acceptance`: not yet run | new app only |

- **Between steps 1 and 5**, an old tab can still post a Story the old way: a bare `story_id`, like the posts from before. That's honest and harmless; it can't write a frozen Story (`story_ref` has no insert grant).
- **Old tabs after step 5** get "Ditt konto kan inte publicera just nu"; their text stays. Reloading fixes it. Wait at least the CDN's 10 minutes after step 3 before step 5.
- Steps 1 and 5 are separate entries in the migration history. With the Supabase CLI, apply step 1 by pushing while only that file is new, or run it in the SQL editor and record it with `supabase migration repair --status applied 20261105183401`; then the same for step 5.
- The file names follow the hosted history: both migrations were renamed to the versions Supabase recorded for them, with their contents unchanged byte for byte, so a fresh database applies them in the same order. Their header comments still use earlier names, left as applied: the first calls the closing migration `20261105090100_…`, and the closing one calls the recovery script `20261105190000_…down.sql`. The recovery script is now [`20261105201518_close_direct_post_inserts.down.sql`](../supabase/rollback/20261105201518_close_direct_post_inserts.down.sql).

**Recovery.**

| Something wrong after… | Do |
|---|---|
| step 1 | Nothing to undo: it only adds. Leave it. Don't drop `story_ref` once any post has one. |
| step 2 | A wrong key only means Stories can't be attached (publishing says so). Fix the value in Vault or Netlify and redeploy. |
| step 3 (before step 5) | Roll back the Netlify deploy ("Publish deploy" on the previous one). The old app keeps working, since direct inserts are still open. Posts published meanwhile keep their frozen Story, and the old app shows them like posts from before. |
| step 5 | First run [`supabase/rollback/20261105201518_close_direct_post_inserts.down.sql`](../supabase/rollback/20261105201518_close_direct_post_inserts.down.sql) in the SQL editor: it restores the old insert grant and policy and changes no rows. Then roll back the Netlify deploy. When the new app is back, re-apply the closing migration's statements by hand (the CLI still lists it as applied). |

## Signing keys

The key only matters **when a post is published**: `publish_post()` checks the signature then, and never again. Reading a post never touches a key, so frozen Stories stay readable whatever happens to keys later. Each frozen Story records its `kid`.

Captures signed with a key live on in:
- **the CDN:** `/` (5 min) and `/api/news` (10 min). A new deploy clears both.
- **open tabs:** a tab keeps the news it loaded until it's reloaded, so for days if left open. The service worker caches no content.

**Planned rotation (old key → new key):**
1. Add the new key to Vault: `select vault.create_secret('<new secret>', 'story_capture_key:<new id>')`. Both keys are now accepted.
2. Set `NUXT_STORY_CAPTURE_KEY_ID` and `NUXT_STORY_CAPTURE_KEY` in Netlify to the new pair and redeploy. New captures use the new key, and the CDN starts fresh.
3. Leave the old key in Vault for a grace period, say 7 days, so open tabs can still attach.
4. Then remove it: `delete from vault.secrets where name = 'story_capture_key:<old id>'`. A tab that still holds an old capture now gets "Storyn gick inte att bifoga just nu…" with its text kept; reloading fixes it.

**A compromised key** (someone could sign made-up headlines):
1. Remove it from Vault at once: `delete from vault.secrets where name = 'story_capture_key:<id>'`. From that moment nothing signed with it is accepted.
2. Add a new key and redeploy, as in planned rotation steps 1 and 2. Until then, Stories can't be attached; publishing without one works.
3. Review what was published with it since the suspected leak:
   ```sql
   select id, author_id, created_at, story_ref -> 'sources' -> 0 ->> 'headline' as headline
   from public.posts where story_ref ->> 'kid' = '<id>' and created_at > '<suspected leak time>'
   order by created_at;
   ```
   Compare the headlines and links with the publishers' sites. Delete a forged post as its author, or in the SQL editor; posts can't be edited. Genuine ones stay as they are.

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
