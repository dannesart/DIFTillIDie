# Supporter profiles: en egen plats på läktaren

Every supporter has a page at **`/laktaren/<handle>`**, e.g. `/laktaren/jarnmannen`. It shows their name, `@handle`, avatar and optional bio, plus their wall: their own Snacket posts. The supporter themselves also see **Mina lag**, their private team interests.

| Part | Where |
|---|---|
| Migrations | [`20261105230000_supporter_profiles.sql`](../supabase/migrations/20261105230000_supporter_profiles.sql), [`20261105231000_profile_handle_aliases.sql`](../supabase/migrations/20261105231000_profile_handle_aliases.sql) |
| Rules shared with the database (avatars, bio, teams) | [`shared/utils/profile.ts`](../shared/utils/profile.ts) |
| Page | [`app/pages/laktaren/[handle].vue`](../app/pages/laktaren/[handle].vue) |
| Address resolution, profile and wall | [`app/lib/wall.ts`](../app/lib/wall.ts) |
| Team interests | [`app/lib/preferences.ts`](../app/lib/preferences.ts) |
| Avatar designs | [`app/components/Avatar.vue`](../app/components/Avatar.vue) |
| The one profile form | [`app/components/ProfileForm.vue`](../app/components/ProfileForm.vue), in `AccountDialog` |

## Identity and addresses

- **A supporter is their user id.** Posts, ownership, permissions and "is this my page" all use it.
- **The handle is only their address:** unique, public and changeable. The page resolves the address to the user id first and uses the id from then on.

| Address | Leads to |
|---|---|
| `/laktaren/lotta` | The supporter whose handle is `lotta`. Capitals and a leading `@` are tidied up. |
| `/laktaren/<former handle>` | The same supporter, through an alias. Replaced by `/laktaren/<handle>`. |
| `/laktaren/<user id>` (older links) | The same supporter. Replaced by `/laktaren/<handle>`. |
| Anything else, or a profile that isn't public | "Tom plats på läktaren". Anything that isn't a handle or a user id never reaches the database. |

### Former handles (aliases)

When a supporter changes their handle, the database keeps the old one in `profile_handle_aliases`, written by a trigger on `profiles`.

- **No impersonation:** a retired handle stays reserved for the supporter who used it. Nobody else can take it (the same "Upptaget" as any taken handle), so an old link never starts pointing at someone else. Its owner can take it back.
- **No hoarding:** each supporter keeps their **5** most recent former handles. Older ones are released. A link to a released handle leads nowhere, or, once someone else takes it, to them. That's the one accepted trade-off.
- **No leaks:** an alias is readable exactly when its profile is. Its policy asks `profiles`, whose own policy decides. When a handle was retired is never readable.
- **Written only by the database:** there are no insert, update or delete grants. The trigger function is `SECURITY DEFINER`, so it can see every alias in order to refuse a reserved one, but it only acts on the row being saved, which RLS has already checked.

### Links

- Names and avatars on posts and comments link to the author's page.
- Clicking `@handle` on a post in the feed still inserts a mention in the composer. On a wall, where there's no composer, handles and mentions are plain text.

## What is public, and when

Nothing about *who* can see a profile changes:

| | Who can read it |
|---|---|
| `display_name`, `handle`, `bio`, `avatar` | **Everyone**, once the supporter has posted or commented (the existing policy). Before that, **only themselves**. |
| `created_at`, `updated_at` | Nobody but the database (no column grant). The page shows no "member since". |
| E-mail address | Never stored in `profiles` at all. |
| Team interests (`profile_preferences`) | **Only the supporter themselves.** Not visitors, not other supporters. |
| Posts | Unchanged: public, as before. |

- The edit form says it under the bio: "Syns för alla, precis som ditt namn, när du har skrivit eller kommenterat i Snacket."
- Until a supporter has posted or commented, their own page says that only they can see it.
- A page that doesn't exist and a page that isn't public yet give **the same** "Tom plats på läktaren". An address that isn't a user id never reaches the database. The page can't be used to find out whether an account exists.
- Supporters' pages have `robots: noindex, nofollow`.
- Old `/laktaren/<user id>` links and former handles are replaced by the current handle only when the profile is visible to the viewer, so a redirect never reveals a private profile's handle.
- **Caching:** like the feed, the profile, wall and team interests load in the browser. The page's HTML (cached by Netlify for 5 minutes) is the same empty shell for everyone and never holds personal data.

## Avatars

- **The default** is today's striped initials, unique to each name.
- **Seven designs** to choose from:
  - `himmel`: sky-blue stripes;
  - `tricolor`: blue, gold and red;
  - `stjarna`: a gold star;
  - `halsduk`: a scarf;
  - `boll`: a football;
  - `puck`: a puck and sticks;
  - `trumma`: a drum.
- All are drawn by the app in the club's colours. There are no uploads, photos or club marks, so there's nothing to moderate but text.
- The database only stores the design's key, checked against the same list.

## Team interests (Mina lag)

- **The four choices:** `fotboll:herr`, `fotboll:dam`, `hockey:herr`, `hockey:dam`. Any combination, or none, is valid. Following hockey dam is allowed even though we have no feed or fixtures for it yet: the feeds don't limit what you follow.
- **Storage:** a separate table, `profile_preferences`, with owner-only RLS. It's separate because Postgres grants column access per role, not per row: a column on `profiles` that the owner can read would also be readable on every public profile.
- **Saving:** `save_team_interests(text[])` creates or replaces your row. It's `SECURITY INVOKER`, so the grants and policies apply exactly as written. The database sorts the list, removes repeats and sets `updated_at`.
- **Use:** shown on your own page and **never used to filter or hide content**. Any future use must be visible to the supporter and possible to switch off.

## The wall

- **Contents:** the supporter's own posts, newest first, 20 at a time ("Visa fler"). It pages by `(created_at, id)`, so new posts never cause repeats. A new index, `posts (author_id, created_at desc, id desc)`, serves it.
- **"N inlägg i Snacket"** is the database's own count of their posts, not the number shown.
- **Post cards** are the same as in the feed: frozen Stories, reactions and comments. The owner can delete their posts from their wall, and the count follows.

## Editing

There is **one** profile form, in the account dialog. "Ändra profil" on your own page opens it, and so does "Ändra profil" in the account dialog. Saving updates your page, your posts and your comments at once. The account dialog has a **"Din läktarplats"** link to your page.

## Later, not now

- **Private walls, and posts only approved followers can read,** are a separate change to the posts read policy (one function deciding who may see whose posts) plus a followers table.
- There is no privacy setting today, because none would be real yet. Public Snacket posts stay public.

## Deploying

1. Apply `20261105230000_supporter_profiles.sql`, then `20261105231000_profile_handle_aliases.sql`. Both are additive: the app in production selects its columns by name and keeps working.
2. Run `supabase/tests/supporter_profiles_rls.test.sql`, `handle_aliases_rls.test.sql` and the other `supabase/tests/*.test.sql` files. `posts_rls.test.sql` now expects `bio` and `avatar` among the public columns, so it only passes after step 1.
3. Deploy the app.

If the app is deployed before step 1, it still works: reading posts, comments, your profile or a wall falls back to the columns without `avatar` and `bio` (`42703`), and a missing alias table means no aliases. Saving a profile and team interests needs the migration.

## Tests

- **[`tests/supporter-profiles-db.test.ts`](../tests/supporter-profiles-db.test.ts)** runs the real migrations in PGlite:
  - bio and avatar rules;
  - only the owner can change them;
  - they're public exactly when the name is;
  - timestamps stay hidden;
  - team interests: any combination, only the four, sorted, owner-only (read, write, forge, delete), need a profile, cascade with it;
  - the wall's paging and count;
  - existing profiles and posts are untouched by the migration;
  - the SQL test file run on an empty and a non-empty database.
- **[`tests/handle-aliases-db.test.ts`](../tests/handle-aliases-db.test.ts)** covers former handles:
  - recorded on a change, and not on a name-only change;
  - reserved against others, including new profiles, and reclaimable by their owner;
  - the 5 most recent kept;
  - nothing left behind by a refused change;
  - visible exactly when the profile is;
  - not writable through the API, and the trigger can't be called directly;
  - cascade with the profile;
  - existing data kept, and an existing supporter's rename recorded;
  - plus [`supabase/tests/handle_aliases_rls.test.sql`](../supabase/tests/handle_aliases_rls.test.sql) (pgTAP, 14 assertions) on an empty and a non-empty database.
- **[`supabase/tests/supporter_profiles_rls.test.sql`](../supabase/tests/supporter_profiles_rls.test.sql)** is the same checks for the real database (pgTAP, 24 assertions, rolled back).
- **[`tests/supporter-profiles.test.ts`](../tests/supporter-profiles.test.ts)** covers the page and team-interest stores against a fake Data API:
  - a hidden profile looks the same whether or not it exists;
  - addresses: handle, capitals and `@`, former handle, old user-id links, unknown handles, nonsense never sent, a database without aliases;
  - paging;
  - failures;
  - a database without the migration;
  - team changes saved only when Supabase confirms them;
  - preferences cleared on account switch;
  - the TypeScript lists matching the SQL.
