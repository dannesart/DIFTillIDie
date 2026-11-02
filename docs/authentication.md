# Supporter accounts: Google sign-in

Supporters can sign in with Google and choose a **display name** and a **unique handle**. Everything else stays public: news, Stories, fixtures and podcasts never require an account. The fictional Snacket på stan posts are untouched.

## How it works

| Part | Where |
|---|---|
| Sign-in flow (PKCE), session, profile state | [`app/lib/auth.ts`](../app/lib/auth.ts) |
| Supabase client, browser only | [`app/plugins/auth.client.ts`](../app/plugins/auth.client.ts) |
| OAuth callback | [`app/pages/auth/callback.vue`](../app/pages/auth/callback.vue) |
| UI | `AccountDialog`, `ProfileForm`, `AccountButton` (desktop header), "Du" tab in `MobileNav` |
| Profile rules (shared with the database) | [`shared/utils/profile.ts`](../shared/utils/profile.ts) |
| Database | [`supabase/migrations/20261102180000_profiles.sql`](../supabase/migrations/20261102180000_profiles.sql) |

- **Flow:**
  1. "Fortsätt med Google" calls `signInWithOAuth({ provider: 'google' })` with `redirectTo = <origin>/auth/callback` and `prompt=select_account`. supabase-js stores a PKCE code verifier in `localStorage`.
  2. Google, then Supabase, redirects back to `/auth/callback?code=…`.
  3. The page calls `exchangeCodeForSession(code)`, loads the profile, and returns to where the supporter started.
  4. If they have no profile yet, the account dialog opens on "Välkommen in!".
- **Session:** stored by supabase-js in `localStorage` under `djurgarn-auth` and refreshed automatically. It's restored when the site or the installed app is reopened.
- **Sign-out:** `signOut({ scope: 'local' })` signs out this device. If the network is down, the local session is removed anyway.

### Privacy

- **We keep only the user's id.** Google's name, e-mail address and picture are never read into app state, stored in `profiles` or shown. A test checks that they never appear.
  - Supabase itself keeps Google's identity data in `auth.users`, which is private to the project.
  - supabase-js's cached session in the supporter's own browser contains it too.
- **No profile is created automatically.** The supporter chooses what to be called.
- **Profiles aren't readable by other supporters yet.** Public display gets its own reviewed policy or view when real Snacket posts arrive.

### Caching and personal data: the `'/': { isr: 300 }` review

- The homepage is cached on Netlify's CDN for everyone. That stays safe because **the server never sees a session**:
  - Sign-in lives entirely in the browser (localStorage, client-only plugin).
  - No cookies are read, and nothing personal is rendered on the server.
  - On the server, `useAuth()` returns a neutral "loading" placeholder, the same as the browser's first render.
- **Verified in the Netlify build:** a request carrying a session-like cookie produces HTML with no session or user data. It contains only the *public* Supabase URL and publishable key.
- **`/auth/**`** is `ssr: false` and `cache-control: no-store`: client-rendered and never cached.
- **If we ever move sessions into cookies or server rendering,** `/` must stop being ISR-cached, or personalised parts must be fetched client-side.

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

### Applying (not done by us; reviewed separately)

```bash
# with the Supabase CLI, linked to the project
supabase db push
# or paste the migration file into the SQL editor
```

### Tests

- **`npm test`** runs [`tests/profiles-db.test.ts`](../tests/profiles-db.test.ts).
  - It covers anonymous access, own-profile create, read and update, and cross-user read, update, insert, takeover and delete with two users. It also covers the rules, the grants, and that the TypeScript and SQL reserved lists match.
  - It runs the real migration in a local Postgres (PGlite). The harness recreates Supabase's roles, `auth.users`, `auth.uid()` and default privileges.
  - It also executes the pgTAP suite below through a small pgTAP stand-in, so that file is known to pass.
- **[`supabase/tests/profiles_rls.test.sql`](../supabase/tests/profiles_rls.test.sql)** is the same checks for the **real** database (pgTAP, 22 assertions).
  - Run it with `supabase test db` (or `--db-url`), as `postgres`.
  - It inserts two users into `auth.users` **inside a transaction that is rolled back**, so nothing persists. Don't run it against production.
- **[`tests/auth.test.ts`](../tests/auth.test.ts)** covers the sign-in states and failure paths against a fake Supabase client: restore, sign-in start, cancelled consent, missing verifier, expired code, network failures, sign-out (also offline), profile create, update and conflict, and privacy.

## Required configuration

### Google Cloud Console

1. **APIs & Services → OAuth consent screen:**
   - User type *External*, app name *Djurgår'n tills jag dör*, a support e-mail and a developer contact.
   - Scopes: the defaults (`openid`, `email`, `profile`) are enough.
   - While the app is in **Testing**, only the listed **test users** can sign in. Publish to **Production** before inviting supporters. Basic scopes don't need Google's verification review.
2. **Credentials → Create OAuth client ID → Web application:**
   - **Authorized redirect URI:** `https://sofolspxorbicgixjwbp.supabase.co/auth/v1/callback`
   - **Authorized JavaScript origins:** `http://localhost:3000` and the production origin (e.g. `https://<site>.netlify.app`).
3. Copy the **Client ID** and **Client secret** into Supabase (next section). The secret belongs **only** in Supabase. This app never needs it.

### Supabase dashboard (djurgarn-dev)

1. **Authentication → Sign In / Providers → Google:** enable it and paste the Client ID and secret.
2. **Authentication → URL Configuration:**
   - **Site URL:** the production origin.
   - **Redirect URLs** (allow-list):
     - `http://localhost:3000/auth/callback`
     - `https://<site>.netlify.app/auth/callback`
     - deploy previews (optional): `https://*--<site>.netlify.app/auth/callback`
3. **Recommended:** **Authentication → Sign In / Providers → Email: disable** e-mail sign-ups while Google is the only way in. Otherwise anyone with the publishable key could create password accounts through the API, even though the UI doesn't offer it.
4. Apply the migration (see above).

### Netlify environment variables

| Variable | Value |
|---|---|
| `NUXT_PUBLIC_SUPABASE_URL` | `https://sofolspxorbicgixjwbp.supabase.co` |
| `NUXT_PUBLIC_SUPABASE_KEY` | the publishable key (`sb_publishable_…`) |

They're read at runtime by the SSR function and sent to browsers, which is fine for a publishable key. **Never** set a secret or service-role key here.

Locally, copy [`.env.example`](../.env.example) to `.env`. If those variables are missing, the account UI hides itself and the rest of the site works as before.

## The installed iPhone app (home-screen PWA)

**What we know** (from WebKit behaviour reports, not yet tested here):

- **Separate storage:** an installed home-screen web app has its own storage, separate from Safari's. Signing in within a Safari tab doesn't sign in the installed app, and vice versa. (Since iOS 17.2, cookies are copied once at install, but we don't use cookies.)
- **Leaving the app:** navigating to `accounts.google.com` leaves the app's scope. iOS shows it in an in-app Safari sheet.
- **Returning:** whether the redirect back to `/auth/callback` (in scope) lands back **inside the standalone app** (where the PKCE verifier lives) or stays in that **Safari sheet** (which may not have the verifier) has varied between iOS versions, and has to be tested on a real device.
- **What we built for this:**
  - Everything happens in the same window, with no popups.
  - The return path and verifier are kept in `localStorage`.
  - If the callback runs where the verifier is missing, it fails cleanly with "Inloggningen avslutades i ett annat fönster…" instead of a broken state.
- **Google blocks sign-in in embedded webviews** (Instagram, Facebook…), so the dialog tells those users to open Safari or Chrome.

**If the real-device test fails,** the sturdy fix is a short-lived server-side handoff:
- Keep the PKCE verifier and state server-side for a few minutes, keyed by the OAuth state, or hand the session over with a one-time code.
- That needs a small server endpoint and storage, so it's deliberately out of scope until we know it's needed.

### Manual test plan (real iPhone, after Google and Supabase are configured)

Use the deployed site (HTTPS). Note the iOS version.

1. **Safari tab, baseline:** open the site → Du/Logga in → Fortsätt med Google → pick an account → you're back on the page you started from, signed in. A new account gets "Välkommen in!".
2. **Profile:** choose a name and handle → Spara profil. Try a taken handle (from a second account) → "Upptaget – välj ett annat." Reload → still signed in, profile shown.
3. **Install:** Dela → Lägg till på hemskärmen. Open the app from the icon. **Expected:** you're *signed out* in the app (separate storage). That's normal.
4. **Sign in inside the installed app:** Logga in → Fortsätt med Google. Note exactly what happens:
   - a. Does Google open in a sheet with a "Klar" button, or does the app switch to Safari?
   - b. After choosing the account, where do you land: back in the standalone app (no Safari UI), or still in the sheet or Safari?
   - c. Are you signed in **in the standalone app**? Close the sheet if one is still open, then check the "Du" tab.
   - d. If you see "Inloggningen avslutades i ett annat fönster…", the callback ran outside the app. Report it; that's the case for the server-side handoff.
5. **Restore:** fully close the installed app (swipe it away), reopen it → still signed in, profile shown.
6. **Sign out** in the installed app → reopen it → signed out. Check that the Safari tab's session is unaffected (separate storage).
7. **Public use while signed out and in:** stories, match card, podcast playback (start an episode, browse, the mini-player keeps playing).
8. **Cancel:** start sign-in and press Cancel or Back at Google → "Inloggningen avbröts…" with a way back.
9. **In-app browser:** open the link from Instagram or Messenger → the dialog warns that Google blocks sign-in there.
10. **Android Chrome** (installed and in a tab): repeat 1, 4 and 5. Android usually returns into the installed app via a Custom Tab, but check.

## Not verified (yet)

- **Real Google sign-in end to end.** It needs the Google provider and redirect URLs configured. All Supabase calls in the browser tests were intercepted (no requests to djurgarn-dev, no users created).
- **The migration and pgTAP suite on the hosted database.** They were run locally in PGlite with a Supabase-like harness, not on Supabase itself.
- **The installed iPhone app's OAuth return** and session restore. Use the manual plan above.
- **Android installed-app behaviour.**
