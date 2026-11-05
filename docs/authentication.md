# Supporter accounts: sign in with an e-mail code

Supporters sign in with a **six-digit code sent by e-mail** and choose a **display name** and a **unique handle**. Everything else stays public: news, Stories, fixtures and podcasts never require an account. The fictional Snacket på stan posts are untouched. Signed in with a profile, you publish real posts (see [snacket-posts.md](snacket-posts.md)).

We first tried Google OAuth. Google's consent screen showed the random Supabase project domain, and fixing that needs a paid custom domain. The installed iPhone app also can't reliably finish a redirect-based sign-in. Email codes avoid both problems: the supporter never leaves the page.

## How it works

| Part | Where |
|---|---|
| Code flow, session, profile state | [`app/lib/auth.ts`](../app/lib/auth.ts) |
| Supabase client, browser only | [`app/plugins/auth.client.ts`](../app/plugins/auth.client.ts) |
| UI | `AccountDialog`, `SignInWithCode`, `ProfileForm`, `AccountButton` (desktop header), "Du" tab in `MobileNav` |
| Profile rules (shared with the database) | [`shared/utils/profile.ts`](../shared/utils/profile.ts) |
| Database | [`supabase/migrations/20261102234401_profiles.sql`](../supabase/migrations/20261102234401_profiles.sql) |
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
- **Profiles:** none are created automatically. With the posts migration, a supporter's `display_name` and `handle` become readable by everyone once they've published a post (see [snacket-posts.md](snacket-posts.md#what-changes-for-profiles)). The optional `bio` and `avatar` design follow exactly the same rule; team interests are never readable by anyone else (see [supporter-profiles.md](supporter-profiles.md)).

### Caching and personal data: the `'/': { isr: 300 }` review

- The homepage is cached on Netlify's CDN for everyone. That stays safe because **the server never sees a session**:
  - Sign-in lives entirely in the browser (localStorage, client-only plugin).
  - No cookies are read, and nothing personal is rendered on the server.
  - On the server, `useAuth()` returns a neutral "loading" placeholder, the same as the browser's first render.
- **Verified in the Netlify build:** a request carrying a session-like cookie produces HTML with no session or user data. It contains only the *public* Supabase URL and publishable key.
- **If we ever move sessions into cookies or server rendering,** `/` must stop being ISR-cached, or personalised parts must be fetched client-side.

## Snacket identity and browser-local content

Everything in Snacket på stan is real and stored in Supabase (see [snacket-posts.md](snacket-posts.md) and [snacket-interactions.md](snacket-interactions.md)). Who may write is decided by the database. On the client, `resolveIdentity` ([`app/lib/localScope.ts`](../app/lib/localScope.ts)) only decides what to offer:

| State | What Snacket offers |
|---|---|
| Signed out (or accounts not configured) | Reading everything; a friendly "Logga in" wherever you'd write, react or comment. No local name. |
| Signed in, profile ready | Publishing, reacting and commenting as the profile's display name and handle. "Du på läktaren" → "Din profil". |
| Signed in, no profile (or it failed to load) | "Välj läktarnamn" first; anything typed is kept. |
| Auth still restoring | A moment's wait; no local content shown. |

- **Still local and per owner:**
  - **Story drafts.** The guest keeps `djurgarn:drafts:v1`, and each account has `djurgarn:drafts:v1:account:<user id>`. Switching account clears a half-typed post or comment and closes an open Story dialog.
  - **Posts written before Snacket became real**, under `djurgarn:snacket:v1` (guest) or `djurgarn:snacket:v1:account:<user id>`, are **dormant**: the app no longer reads them, and never publishes, migrates or deletes them.

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
2. **Email OTP length: 6** (configured). The app expects six digits (`CODE_LENGTH`).
3. **Email OTP expiration: 600 s / 10 min** (configured). Shorter than the default hour is kinder to security. The app forgets a pending code after an hour regardless.
4. **Authentication → Emails → Templates:** paste [`supabase/templates/otp-code.html`](../supabase/templates/otp-code.html) into **both "Magic link" and "Confirm signup"**.
   - New supporters may get the latter.
   - Subject: *Din inloggningskod till Djurgår’n*.
   - The template must show **`{{ .Token }}`** and must **not** contain `{{ .ConfirmationURL }}`. The app never handles links.
5. **Allow new users to sign up:** on, for open registration.
6. **Google provider:** can be disabled again. It isn't used.
7. Redirect URLs are **not** needed for code sign-in. The Site URL only appears in templates that use links, and ours doesn't.
8. The migration: applied, as version `20261102234401` (the repository file carries the same version, so `supabase db push` sees no pending migration).

### E-mail delivery (SMTP): a production sender is still needed before inviting supporters

- **Today: temporary development SMTP through Gmail.** It's configured in the Supabase dashboard only. No SMTP credentials are in this repository, in `.env.example` or in Netlify.
- **It's a stopgap, not the launch sender.** A personal or dedicated Gmail mailbox has daily sending limits, sends as that mailbox, and its deliverability for a public audience isn't something we control.
- **Supabase's built-in sender** isn't an alternative: it delivers only to members of the Supabase organisation's team, and it's heavily rate-limited.
- **Before external supporters are invited,** choose the production sender under **Authentication → Emails → SMTP Settings**, and raise the e-mail rate limit under **Authentication → Rate Limits** to match.
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

## Manual test plan (real devices)

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
11. **Story drafts, per account:**
    - Signed in, start a Story draft and close the dialog. "Fortsätt ditt utkast" appears.
    - Sign out → the draft isn't offered.
    - Sign in as someone else → it isn't offered either.
    - Sign back in as yourself → it's back.

Real posts have their own two-device plan in [snacket-posts.md](snacket-posts.md#manual-two-device-test-plan-after-applying-the-migration).

## Verified against the hosted project

- **Migration:** applied to djurgarn-dev as `20261102234401_profiles`. All 22 pgTAP authorization checks passed there, run independently.
- **Real sign-in on desktop:** a real six-digit code arrived by e-mail (Gmail development SMTP) and signed in, and creating a profile worked.
- **Settings:** OTP length 6 and expiry 600 s are configured.

## Not verified (yet)

- **The installed iPhone app on a real device:** sign-in, switching to Mail and back, reloads and session restore. Use steps 5–7 of the plan above.
- **Android**, in a tab and installed.
- **The exact live error texts** for rate limits, expired codes and closed sign-ups. They're matched by error code and by message, but have only been exercised against intercepted responses.
- **Whether new users get the "Magic link" or the "Confirm signup" template.** Configure both.
- **Production e-mail delivery** to external supporters' inboxes. It needs the production sender above.
