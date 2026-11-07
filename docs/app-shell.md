# The desktop app shell (Mission #17)

From 1024 px wide: a persistent sidebar (sections, sport, account, pilot
status), one view at a time in the middle, and from 1280 px a rail with the
next match and the newest episodes. Phones and tablets keep today's front
page, header, bottom nav and pilot banner.

## Switching it on and off

One build-time environment variable: `APP_SHELL=1`. It decides which routes
exist, so it takes effect on the next build, never on a running deploy.

| | `APP_SHELL` unset (default) | `APP_SHELL=1` |
|---|---|---|
| `/` | today's front page | desktop: Hem overview · phones: today's front page |
| `/snacket`, `/stories`, `/lyssna` | 302 to `/#snacket` etc. | the section's view (ISR, 5 min, like `/`) |
| `/laktaren/<handle>` | today's page | the same address, in the shell |
| `/#snacket`, `/#story-…`, `/#post-…` | in-page sections | phones: in-page sections · desktop: sent to the view |

Deploy previews (pull requests) get it from `netlify.toml`
(`[context.deploy-preview.environment]`); production and branch deploys
don't. To switch production on, add `APP_SHELL = "1"` under
`[context.production.environment]` (or set it in Netlify's UI for the
Production context) and deploy. Values in `netlify.toml` win over the UI.

**Rollback:** remove the production setting and redeploy, or use Netlify's
"Publish deploy" on the last deploy built without it, which is instant. With the shell off, `/snacket`, `/stories` and
`/lyssna` redirect to the front page's sections, so links shared while it
was on keep working. A new deploy replaces the cached pages.

The development prototype at `/prototyp` (under `nuxt dev`, or a build with
`APP_SHELL_PREVIEW=1`) uses the same components, and keeps its "Prototyp"
labels and noindex title to tell it apart.

## How one page serves both screens

The server can't know the screen size, and `/` is cached once for everyone,
so the server HTML contains both the desktop part (sidebar, rail, Hem
overview) and the phone part (header, long front page, bottom nav); CSS shows
one. Only the visible one is *hydrated*
(`defineLazyHydrationComponent('mediaQuery', …)`, see `useScreenParts` in
`composables/useViewport.ts`): the other stays inert HTML, with no component
setup, listeners, observers or requests, until the window crosses 1024 px.
When moving between pages in the browser, only the part that fits is built.

Measured locally on `/` (production builds):

| | shell off | shell on |
|---|---|---|
| HTML (gzip) | 17 KB | 20 KB |
| JS loaded up front (gzip) | 192 KB | 172 KB |
| JS prefetched at idle, run only if needed (gzip) | 3 KB | 43 KB |
| Elements with live handlers: desktop / phone | 87 / 87 | 50 / 88 |
| Snacket requests per load | 2–3 | 2 |
| Hydration mismatches, duplicate ids | none | none |

Links in shared components stay the classic hash links (`lib/sectionLinks.ts`),
which work on every screen size; on desktop the router turns them into the
views (`plugins/app-shell.client.ts`), including addresses opened directly.

## Before switching it on in production

- Signed-in flows in the shell, on desktop and on a phone: post, react,
  comment, "Min läktare", edit the profile, sign out (reactions and drafts cleared).
- Old links on desktop and on a phone: `/#snacket`, `/#stories`, `/#lyssna`,
  a post's Story, a supporter's page and an old handle's address.
- A podcast keeps playing between `/`, `/snacket`, `/stories`, `/lyssna` and a
  supporter's page.
- Rotating a tablet across 1024 px, the install prompt on a phone, and the
  deploy preview's caching (`/snacket` etc. served from the CDN).
