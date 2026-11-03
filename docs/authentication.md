# Supporter accounts: sign in with an e-mail code

Supporters sign in with a **six-digit code sent by e-mail** and choose a **display name** and a **unique handle**. Everything else stays public: news, Stories, fixtures and podcasts never require an account. The fictional Snacket på stan posts are untouched. Signed in, you snack under your own profile, still locally only (see [Snacket identity](#snacket-identity-local-only)).

We first tried Google OAuth. Google's consent screen showed the random Supabase project domain, and fixing that needs a paid custom domain. The installed iPhone app also can't reliably finish a redirect-based sign-in. Email codes avoid both problems: the supporter never leaves the page.

## How it works

| Part | Where |
|---|---|
| Code flow, session, profile state | [`app/lib/auth.ts`](../app/lib/auth.ts) |
| Supabase client, browser only | [`app/plugins/auth.client.ts`](../app/plugins/auth.client.ts) |
| UI | `AccountDialog`, `SignInWithCode`, `ProfileForm`, `AccountButton` (desktop header), "Du" tab in `MobileNav` |
| Profile rules (shared with the database) | [`shared/utils/profile.ts`](../shared/utils/profile.ts) |
| Database | [`supabase/migrations/20261102180000_profiles.sql`](../supabase/migrations/20261102180000_profiles.sql) |
| E-mail template | [`supabase/templates/otp-code.html`](../supabase/templates/otp-code.html) |

1. **Address:** the supporter types an e-mail address, and `signInWithOtp({ email, options: { shouldCreateUser } })` sends the code.
   - The address is trimmed and lowercased, and checked before any request.
   - The pending address and send time are kept in `localStorage` for up to an hour. So if the installed iPhone app is reloaded while the supporter checks Mail, it still shows the code step.
2. **Code:** the supporter types the code (iOS can offer it straight from Mail, via `autocomplete="one-time-code"`), and `verifyOtp({ email, token, type: 'email' })` signs them in. The form submits by itself at six digits, and pasted `123 456` or `123-456` works.
3. **Profile:** new supporters land on "Välkommen in!" to choose a name and handle. Returning supporters see their profile.

- **Resend:** a 60-second client cooldown, matching Supabase's default limit. If Supabase asks for a longer wait ("only request this after N seconds"), we show that instead.
- **Errors**, each with its own calm message:
  - invalid address;
  - code e-mail rate limit;
  - too many requests;
  - new accounts refused;
  - wrong or expired code (the supporter stays on the code step);
  - too many attempts;
  - network failure on either step.
- **Session:** supabase-js stores it in `localStorage` (`djurgarn-auth`) and refreshes it automatically. It's restored when the site or the installed app is reopened.
- **Sign-out:** `signOut({ scope: 'local' })` signs out this device. Offline, the local session is removed anyway.
- **No redirects:** nothing arrives via the URL (`detectSessionInUrl: false`), and there's no callback page. That's why this works the same in Safari, Chrome, Android, in-app browsers and the installed home-screen app.

### Privacy

- **Our state holds:** the user's id, and, while a code is pending, the address the supporter typed, on their own device.
- **The e-mail address:** it's never shown to anyone else and never stored in `profiles`. Supabase keeps it in `auth.users`, which is private to the project.
- **Profiles:** none are created automatically, and they aren't readable by other supporters yet. Public display gets its own reviewed policy or view when real Snacket posts arrive.

### Caching and personal data: the `'/': { isr: 300 }` review

- The homepage is cached on Netlify's CDN for everyone. That stays safe because **the server never sees a session**:
  - Sign-in lives entirely in the browser (localStorage, client-only plugin).
  - No cookies are read, and nothing personal is rendered on the server.
  - On the server, `useAuth()` returns a neutral "loading" placeholder, the same as the browser's first render.
- **Verified in the Netlify build:** a request carrying a session-like cookie produces HTML with no session or user data. It contains only the *public* Supabase URL and publishable key.
- **If we ever move sessions into cookies or server rendering,** `/` must stop being ISR-cached, or personalised parts must be fetched client-side.

## Snacket identity (local only)

Snacket på stan has no posts backend yet. Everything a visitor writes, reacts to or drafts stays in their browser's `localStorage`. What signing in changes is **who** that content is written as, and **whose** local content is shown.

- **Owners.** Local content is stored per owner ([`app/lib/localScope.ts`](../app/lib/localScope.ts)):
  - The **guest** keeps the original keys, `djurgarn:snacket:v1` and `djurgarn:drafts:v1`, so existing data is untouched.
  - Each **signed-in account** gets its own keys, suffixed `:account:<user id>`.
- **Who you post as:**

  | State | Identity |
  |---|---|
  | Signed out (or accounts not configured) | The local guest name, "Du @blarandiggast" by default, changed with "Byt namn". Unchanged from before. |
  | Signed in, profile ready | The profile's display name and handle, and the avatar derived from the name. "Du på läktaren" opens the account dialog ("Din profil") instead of "Byt namn". |
  | Signed in, no profile (or it failed to load) | You can't post or comment yet. "Välj läktarnamn" opens the profile step, and anything typed is kept. |
  | Auth still restoring | No local content is shown, and posting waits a moment. |

- **Live authorship.** Everything in an account's bucket was written by that account, so its posts and comments always show the **current** profile. A profile edit updates them at once, with no reload.
- **No re-attribution.** Guest posts are never shown as, or moved to, the signed-in supporter. While signed in they're hidden, and "Du på läktaren" says how many there are. They come back on sign-out.
- **Switching accounts on one browser:**
  - Each account sees only its own local posts, reactions, comments and Story drafts.
  - A half-typed post or reply is cleared, and an open Story dialog closes.
  - An account's own content is only ever shown under that account's own profile: `resolveIdentity` checks that the profile's id matches the bucket.
- **Still local and demo:**
  - Own posts carry "🔒 bara här".
  - The Story dialog and "Du på läktaren" say that nothing is visible to anyone else.
  - The section is labelled demo.
  - Signing out keeps an account's local content in this browser, as before, so it returns when the supporter signs in again. It's never shown to anyone else on the page.

Tests: [`tests/local-scope.test.ts`](../tests/local-scope.test.ts) covers owners, keys and identity, including a profile that doesn't match the bucket. The browser test is described under [Manual test plan](#manual-test-plan-real-devices-once-a-sender-is-configured).

## Registration modes (future): signing in is not permission

We'll eventually want **open**, **approval-required** and **closed** registration, and existing approved supporters must always be able to sign in. The design keeps three things separate:

| Question | Answered by |
|---|---|
| *Who are you?* | Signing in (email code). Proves identity only, grants nothing. |
| *May a new account be created?* | `shouldCreateUser` (the `allowNewAccounts` option in `createAuth`) and Supabase's "Allow new users to sign up" setting |
| *May you post / take part?* | A future database-enforced membership or approval state, checked by RLS on the posts themselves |

- **Open (today):** `allowNewAccounts: true`. Anyone can create an account and a profile.
- **Closed:** `allowNewAccounts: false`, plus "Allow new users to sign up" off in Supabase.
  - Existing supporters still get codes and sign in.
  - New addresses get "Nya konton kan inte skapas just nu", a message we already handle.
- **Approval-required:** accounts and profiles can be created, but posting and other privileges need an approved state set by moderators, for example a `memberships` table or a `status` column that only moderators can change.
  - RLS on posts checks that state, never just `auth.uid()`.
  - Nothing in today's code treats "signed in" as "allowed to post".

None of this is implemented yet. There are no posts, no approval and no roles.

## Database: `profiles`

- **Columns:** `id` (= `auth.users.id`, cascade on delete), `display_name`, `handle`, `created_at`, `updated_at`.
- **Constraints:**
  - The handle is unique, `^[a-z0-9_]{3,20}$`, and not reserved (dif, djurgarden, admin, …).
  - The display name is 2–40 characters, trimmed, with no control characters.
  - `updated_at` is set by a trigger.
- **Grants:** they start from nothing, because Supabase's default privileges grant ALL to anon and authenticated:
  - `anon`: nothing.
  - `authenticated`: `SELECT`, plus `INSERT (id, display_name, handle)` and `UPDATE (display_name, handle)`, column-level.
  - No `DELETE`.
- **RLS:** select, insert and update only where `auth.uid() = id`.

The migration has been **applied to the hosted project** (djurgarn-dev) after review, and the 22 pgTAP authorization checks passed there.

### Tests

- **`npm test`** runs [`tests/profiles-db.test.ts`](../tests/profiles-db.test.ts).
  - It covers anonymous access, own-profile create, read and update, and cross-user read, update, insert, takeover and delete with two users. It also covers the rules, the grants, and that the TypeScript and SQL reserved lists match.
  - It runs the real migration in a local Postgres (PGlite). The harness recreates Supabase's roles, `auth.users`, `auth.uid()` and default privileges.
  - It also executes the pgTAP suite below through a small pgTAP stand-in, so that file is known to pass.
- **[`supabase/tests/profiles_rls.test.sql`](../supabase/tests/profiles_rls.test.sql)** is the same checks for the **real** database (pgTAP, 22 assertions).
  - Run it with `supabase test db` (or `--db-url`), as `postgres`.
  - It inserts two users into `auth.users` **inside a transaction that is rolled back**. Don't run it against production.
- **[`tests/auth.test.ts`](../tests/auth.test.ts)** covers the sign-in states and failure paths against a fake Supabase client:
  - sending a code, validation, cooldown, the server's retry hint, closed registration and network failures;
  - verifying, wrong or expired codes, too many attempts, and a pending code surviving an app reload or expiring;
  - session restore, sign-out (also offline), profile create, update and conflict, and privacy.

## Required configuration

### Supabase dashboard (djurgarn-dev)

1. **Authentication → Sign In / Providers → Email:** enabled. Leave **Confirm email** on: the code itself is the confirmation.
2. **Email OTP length: 6.** The app expects six digits (`CODE_LENGTH`).
3. **Email OTP expiration:** shorter than the default hour is kinder to security, e.g. **600 s (10 min)**. The app forgets a pending code after an hour regardless.
4. **Authentication → Emails → Templates:** paste [`supabase/templates/otp-code.html`](../supabase/templates/otp-code.html) into **both "Magic link" and "Confirm signup"**.
   - New supporters may get the latter.
   - Subject: *Din inloggningskod till Djurgår’n*.
   - The template must show **`{{ .Token }}`** and must **not** contain `{{ .ConfirmationURL }}`. The app never handles links.
5. **Allow new users to sign up:** on, for open registration.
6. **Google provider:** can be disabled again. It isn't used.
7. Redirect URLs are **not** needed for code sign-in. The Site URL only appears in templates that use links, and ours doesn't.
8. The migration: applied.

### E-mail delivery (SMTP): required before inviting supporters

- **Supabase's built-in sender is for development only.** It delivers only to members of the Supabase organisation's team, and it's heavily rate-limited.
- **No custom SMTP is configured, and none is included here.**
- **Before external supporters can sign in,** configure **Authentication → Emails → SMTP Settings** with a real provider, and raise the e-mail rate limit under **Authentication → Rate Limits** to match.
- **Options:**
  - Providers that verify a sending domain (Resend, Brevo, Postmark, …) need a domain we control, which a `*.netlify.app` address isn't.
  - A dedicated mailbox's SMTP (e.g. a Gmail app password) needs no domain, but has daily sending limits and sends as that mailbox.

### Netlify environment variables

| Variable | Value |
|---|---|
| `NUXT_PUBLIC_SUPABASE_URL` | `https://sofolspxorbicgixjwbp.supabase.co` |
| `NUXT_PUBLIC_SUPABASE_KEY` | the publishable key (`sb_publishable_…`) |

They're read at runtime by the SSR function and sent to browsers, which is fine for a publishable key. **Never** set a secret or service-role key here.

Locally, copy [`.env.example`](../.env.example) to `.env`. If those variables are missing, the account UI hides itself and the rest of the site works as before.

## Manual test plan (real devices, once a sender is configured)

1. **Safari tab:** Du/Logga in → address → Skicka kod → the e-mail arrives with the code, styled, with no link → type the code (or tap the iOS suggestion) → "Välkommen in!" → choose name and handle → saved.
2. **Wrong code** → "Koden stämmer inte…", the field clears and you can try again.
3. **Expired code:** wait past the configured expiry, then enter it → same message, and "Skicka ny kod" works.
4. **Resend** shows a countdown and works when it reaches zero. Rapid requests show "Vänta lite…".
5. **Installed iPhone app:** sign in. While the code is on its way, switch to Mail and back, and if possible let iOS reload the app → the code step is still there → enter the code → signed in **inside the app**.
6. **Restore:** fully close the installed app and reopen it → still signed in, profile shown.
7. **Sign out** → reopen → signed out. The Safari tab is unaffected (separate storage).
8. **Change address** on the code step → back to step 1.
9. **Public use, signed out and in:** stories, match card, podcast playback with the mini-player.
10. **Android Chrome,** tab and installed: repeat 1, 5 and 6.
11. **Snacket identity:**
    - As a guest, post something.
    - Sign in → your guest post is hidden, and "Du på läktaren" shows your profile and mentions the guest post.
    - Post, comment and start a Story draft → all show your name.
    - Change your profile → they update at once.
    - Sign out → only the guest post is back.
    - Sign in as someone else → none of the first account's posts, comments or drafts are shown.

The equivalent of step 11 was run in a headless browser against the dev server, with all Supabase calls intercepted. It covered:

- existing guest data;
- signing in without a profile, then creating one;
- editing the profile (posts, comments and avatar updated live);
- signing out;
- a second, returning account on the same browser;
- reloading;
- switching back.

## Not verified (yet)

- **Real e-mail delivery and real `signInWithOtp` / `verifyOtp` against Supabase.** All Supabase calls in the browser tests were intercepted, and the hosted project hasn't been touched.
  - The exact error texts the live Auth server returns for rate limits and closed sign-ups are matched by code and by message. Recheck them once live.
- **Whether new users get the "Magic link" or the "Confirm signup" template.** Configure both.
- **The installed iPhone app on a real device:** Mail switching, reloads and restore. Use the plan above.
