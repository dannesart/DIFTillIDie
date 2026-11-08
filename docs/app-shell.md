# The app shell (Mission #17)

Every page is laid out by the app shell ([`app/shell/AppShell.vue`](../app/shell/AppShell.vue),
routes in [`modules/app-shell.ts`](../modules/app-shell.ts)).

- **Desktop, from 1024 px:** a persistent sidebar for navigation and
  identity: the sections, then the pilot status and your account at its
  foot. The middle shows one view at a time. From 1280 px (1536 px on
  Snacket and Stories, which have their own side column) a rail shows the
  next match, the newest episodes and, below them, what's playing. Where
  there's no rail, the mini-player floats bottom right instead. Desktop has
  no sport switch, so its sport filter is always "Allt".
- **Phones and tablets:** the long front page, header, bottom nav and pilot
  banner.
- **Every screen:** the footer, with its full disclaimers.

| Address | Desktop | Phones and tablets |
|---|---|---|
| `/` | Hem's overview | the front page with every section |
| `/snacket`, `/stories`, `/lyssna` | the section's view | the same view |
| `/#snacket`, `/#story-…`, `/#post-…` | sent to the view (`/snacket`, `/stories#story-…`, `/snacket#post-…`) | in-page sections |
| `/laktaren/<handle>` | a supporter's place on the stands | the same |

`/`, the three views and supporters' pages are cached by Netlify for
5 minutes (ISR). Their HTML is the same for everyone: sign-in, Snacket and
drafts live in the browser.

**Rollback:** in Netlify, use "Publish deploy" on a deploy from before the
shell (instant). That older build has no `/snacket`, `/stories` or `/lyssna`,
so links to those addresses shared since then would 404 until the next deploy.

## How one page serves both screens

The server can't know the screen size, and `/` is cached once for everyone,
so the server HTML contains both the desktop part (sidebar, rail, Hem
overview) and the phone part (header, long front page, bottom nav); CSS shows
one. Only the visible one is *hydrated*
(`defineLazyHydrationComponent('mediaQuery', …)`, see `useScreenParts` in
`composables/useViewport.ts`): the other stays inert HTML, with no component
setup, listeners, observers or requests, until the window crosses 1024 px.
When moving between pages in the browser, only the part that fits is built.

Measured on `/` (local production builds), before and after the shell:

| | before | with the shell |
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

Moving between views is client-side under one parent route, so the single
`<audio>` element in `app.vue` keeps playing.
