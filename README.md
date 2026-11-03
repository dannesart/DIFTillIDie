# Djurgår’n tills jag dör

A digital home for Djurgården supporters, covering football and hockey: stories with their sources kept intact, the supporter feed *Snacket på stan*, and podcasts and videos.

> **All real, in pilot.**
> - **Stories** come from the publishers' own RSS feeds, and **podcast episodes** from the shows' own feeds.
> - **The next match** comes from the clubs' official schedules (see [Fixtures](#fixtures)).
> - **Snacket på stan** has posts, reactions and comments by signed-in supporters, stored in Supabase (see [Real posts](docs/snacket-posts.md)). There is no fictional content.
>
> Some visitors wrote posts before Snacket became real; those were only ever saved in their own browser. They are left dormant there: never shown, uploaded or deleted. Search engines are kept out for now: a `noindex` meta tag plus an `X-Robots-Tag` header.

## Stack

- [Nuxt 4](https://nuxt.com) (Vue 3, TypeScript), SSR
- Tailwind CSS 4 via `@tailwindcss/vite`
- `@nuxt/fonts`: Fraunces, Inter and JetBrains Mono, self-hosted at build time
- Node 22 (see `.nvmrc`)

## Development

```bash
npm install
npm run dev         # http://localhost:3000
npm run typecheck   # vue-tsc via nuxt typecheck
npm run build       # production build
npm run preview     # run the production build locally
npm test            # unit tests (fixtures from real feeds, no network)
npm run test:live   # hits the real feeds and podcast audio
```

## Domain

The vocabulary is kept small, in [`shared/types/domain.ts`](shared/types/domain.ts):

- **Story**: an event, as one or more SourceArticles. It has no headline of its own: it shows the earliest source's original headline, credited to that source. `sharedNames` lists the names that caused the sources to be grouped.
- **SourceArticle**: one outlet's article. It keeps its own publisher, original headline, the publisher's own teaser, URL and publication date, and is never merged with other sources.
- **Post**: a supporter's post in Snacket, with @mentions, #tags, an optional attached Story, reactions and comments. Everything is stored in Supabase (`public.posts`, `post_comments`, `post_reactions`).

Times shown relative to "now" use one moment fixed on the server (`useDemoNow`, named from its demo days), so SSR and hydration agree.

## Things to try

- **On a phone or tablet**, the bottom bar (Hem · Stories · Snacket · Lyssna) jumps between sections without reloading, so podcasts keep playing. The active section is highlighted, and the bar steps aside while you type.
- **Allt / Fotboll / Hockey** in the header filters the whole page: stories, feed and next match.
- **Source pills** link straight to each original article.
- **"Snackas om i N inlägg"** on a Story filters the feed to posts about it. An attached Story inside a post scrolls back to that Story and highlights it.
- **Newest first.** Snacket på stan is a plain, chronological feed of real posts: no ranking.
- **"Snacka om detta"** on any Story opens a dialog (a bottom sheet on phones) for writing about it, with the Story attached. Drafts survive closing it by accident. Signed in with a profile, the post is published to Snacket på stan for everyone. The small "💬 N inlägg" link next to the button takes you to what's already been said.
- **The source badge on the match card** ("dif.se" / "Verifierad …") opens details on team coverage and where the fixtures come from.
- **Click an @handle** to mention that person in the composer. **Click a #tag** to filter the feed.
- **"Lägg i kalendern"** downloads an `.ics` file for the real next match.
- After 23:00 the night sky comes out, and the podcast gets a 🌙 badge.
- **Start an episode, then scroll away.** A mini-player follows you through Stories and Snacket, driving the same audio element as the main player. On phones it steps aside while you type, and lock-screen controls work through the Media Session API.
- Type **D-I-F** anywhere on the page.

## News feeds

| Feed | Scope | Status (2026-11-02) |
|---|---|---|
| [Bollsvenskan, DIF](https://bollsvenskan.se/feed/djurgardens-if) | Team feed, every item kept; **compiled** (see below) | ✅ 20 items, all about DIF |
| [Sportbladet, fotboll](https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/) | Broad, filtered | ✅ 39 items, 3 about DIF |
| [Sportbladet, hockey](https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/hockey/) | Broad, filtered | ✅ 39 items, 1 about DIF |
| [Djurgårn by night](https://feed.pod.space/djurgarnbynight) | Podcast | ✅ 99 episodes, playable MP3s |
| [Blårandigt Snack](https://feeds.acast.com/public/shows/68d05bae2cf15c8db006caa8) | Podcast (Acast), added 2026-11-02 at a supporter's request | ✅ 76 episodes, playable MP3s |

Sources investigated but **not integrated**:

| Source | Finding |
|---|---|
| [SvenskaFans](https://www.svenskafans.com/svenskafans/rss) | Every URL returns `403` from CloudFront, including the RSS index, the homepage and `robots.txt`. We could not find a documented team feed URL, and we don't work around blocks, for example by spoofing a browser. Worth asking SvenskaFans for feed access: Bollsvenskan cites them. |
| [TV4](https://www.tv4.se/rss) | Only a general news feed (48 items over about 3 days, 1 tagged Sport). Sport paths return `404`, and `?category=`/`?tag=` are ignored. Its one Djurgården mention was a TT wire piece about Hammarby that names DIF in passing. The feed also carries full article text in `<description>`. No usable DIF coverage. |

### Compiled reporting

Bollsvenskan summarises other outlets' reporting: its articles end with "Läs hela artiklarna hos …" and list their sources. The feed doesn't carry those sources, and we don't scrape article pages, so the whole source is configured as `reporting: 'compiled'`. As a result:

- A Story leads with a headline from **original** reporting when it has one.
- Counts never treat a compilation as independent confirmation: "2 egna rapporter · Sportbladet · 2 sammanställningar".
- Compiled articles are labelled "sammanställer andra medier".

### Story ids

A Story's id is `story-<id of its earliest article>`. Article ids come from the publisher plus the canonical URL (tracking parameters removed), so they don't change when an article reaches us through another feed. A Story also answers to the id of **any** of its articles (`storyAnswersTo` in [`shared/utils/story.ts`](shared/utils/story.ts)), so a post's reference survives when Stories merge or when a newer article takes the lead.

**Known limitation:** feeds only hold their latest 20–40 items. Once the referenced article has left every feed, the reference can't be resolved. Stories can also split again when the article that linked them drops out. If supporter posts are ever stored permanently, store the referenced **SourceArticle** (URL, headline, outlet, date) with the post, rather than only a Story id.

How it works, in [`server/lib/`](server/lib/) (plain, testable functions) and [`server/utils/feeds.ts`](server/utils/feeds.ts) (caching):

- **Filtering broad feeds:** an item is kept only if "Djurgården", "Djurgårdens", "Djurgår'n" or "DIF" appears in its headline, teaser or URL slug. Sportbladet often names the club only in the slug.
- **Grouping into Stories** ([`grouping.ts`](server/lib/grouping.ts)) is conservative. Two articles are linked only if all of these hold:
  - they're the same sport;
  - they were published within 24 h of each other;
  - they share at least 2 distinctive names (people, clubs);
  - at least 1 of those names is in both headlines.

  Anything else stays a single-source Story. Nothing is AI-generated: no summaries, and no headlines of our own.
- **No images or full text:** we show only the publisher's headline and its short feed teaser, and always link to the original article.
- **Caching:**
  - Each feed is cached in memory for 10 min (Nitro `defineCachedFunction`, stale-while-revalidate). Failures are never cached.
  - If a fetch fails or times out (8 s), the last good result is shown and marked stale. If there is none, the source is shown as unreachable; nothing is invented.
  - On Netlify, `isr` route rules add durable CDN caching: `/` for 5 min and `/api/*` for 10 min.
- **Endpoints:** `/api/news` and `/api/podcast`, each returning a status per source.

## Fixtures

The next-match card counts down to verified first-team matches. It covers:

| Team | Coverage | Source |
|---|---|---|
| Fotboll herr | Automatic | dif.se's public match-calendar subscription: [`/api/calendar?category=herrar`](https://www.dif.se/api/calendar?category=herrar), the link offered on [dif.se/matcher](https://www.dif.se/matcher) |
| Fotboll dam | Automatic | Same, with `category=damer` |
| Hockey herr | **Manual** | [`server/lib/fixtures.ts`](server/lib/fixtures.ts) `MANUAL_FIXTURES`, each entry checked against [difhockey.se](https://www.difhockey.se/game-schedule) and stamped with `verifiedAt` |
| Hockey dam (SDHL) | None yet | Shown on the card as "no verified schedule yet" |

What we found when looking for machine-readable fixture data (2026-11-02):

- **dif.se** publishes iCalendar subscriptions per squad: herrar, damer and ungdom. The responses are `text/calendar` with `max-age=14400`. Event times are floating local times, with `X-WR-TIMEZONE: Europe/Stockholm` set on the calendar. We convert them to UTC with DST handled (see [`server/lib/ics.ts`](server/lib/ics.ts)).
- **difhockey.se and shl.se** offer only an ECAL sign-up widget ("Kalenderfil SHL/SDHL" → `ql.e-c.al`), which gives each subscriber a personal calendar. We found no public feed or supported schedule API. We don't scrape the schedule pages or reuse the widget's key, so hockey is maintained by hand. **Add new hockey fixtures to `MANUAL_FIXTURES` after checking difhockey.se.** Past entries drop off automatically.

Rules:

- **First team only:** we fetch only the herrar and damer calendars, and keep only competitions known to be first-team (Allsvenskan, OBOS Damallsvenskan, Svenska cupen and friendlies). *Ligacupen Elit* is in the herrar calendar, but we haven't verified its level, so it's excluded.
- **Status notes:** "(trupp annonserad)" is removed from the title. "(preliminär tid och datum)" becomes a *Preliminär tid* badge.
- **Never a past match:** the server sends only upcoming fixtures, and the client re-checks against its own clock every second. A match whose kickoff has passed is never "next".
- **Honest empty state:** if nothing verified is coming up, the card says so.
- **Caching:** 30 min in memory (stale-while-revalidate, last good result on failure), plus Netlify CDN on `/api/fixtures` for 15 min. If dif.se can't be reached, the hand-verified hockey match still shows.

## Podcasts and video

*Djurgårn by night* and *Blårandigt Snack* (Cosmos & Victor) both play in the app.

- **Show picker:** accessible tabs, with an equaliser on the show that's playing. It starts on the freshest episode, or on the night show after dark.
- **One audio element** for the whole page, in `PodcastAudio.vue`. Starting any episode replaces the current stream, and the mini-player follows whichever show is playing.
- **Audio** streams from the MP3 enclosure each show publishes in its RSS feed for podcast players. It's credited to the show and linked to its own page and listening links.
- **If a show's feed can't be reached,** its tab says so and offers direct listening links.
- **Adding a show** means adding an entry to `PODCAST_SHOWS` in [`server/lib/podcast.ts`](server/lib/podcast.ts).

**DIFpodden** now lives on [Patreon](https://www.patreon.com/cw/difpodden). Its Acast feed stopped in March 2023. What we found on 2026-11-02:

- **The Patreon page** shows the campaign has Patreon's *public RSS* switched on (`has_public_rss`), as well as a member feed and a Spotify integration ("DIFpodden Patreons").
- **The public feed's address isn't published anywhere we could verify.** Patreon creators copy it from their own settings, `patreon.com/rss/difpodden` returns 404, and Apple Podcasts and Poddtoppen still list only the archived Acast feed. We don't guess feed URLs, use Patreon's internal API, or touch member feeds.

So DIFpodden gets a static discovery card with "Lyssna hos Patreon", the Spotify show, the archive up to March 2023 and an honest "why no play button". If the podcast shares its public RSS address, it can become a third entry in `PODCAST_SHOWS`.

`app/data/media.ts` links the remaining shows and channels (DIFpodden, YouTube) to real search pages on Spotify, Apple Podcasts and YouTube, because we haven't verified their official IDs yet. Once you have a verified ID, add `embed` to the item:

- Spotify: `https://open.spotify.com/embed/show/<id>`
- YouTube: `https://www.youtube-nocookie.com/embed/<videoId>` or `.../embed/videoseries?list=<playlistId>`

The card then shows a click-to-load player. Nothing is loaded from Spotify or YouTube until the visitor asks for it.

## Supporter accounts (e-mail code)

Supporters sign in with a six-digit code sent by e-mail (Supabase `signInWithOtp` / `verifyOtp`), without ever leaving the page, and choose a display name and handle. Nothing public requires an account, and Snacket på stan's fictional posts are unchanged.

Signed in with a profile, you **publish**, **react** (💙 🔥 ⭐ 😭, one per post) and **comment** in Snacket på stan under that name and handle, for everyone to read. Reactions and comments: [`docs/snacket-interactions.md`](docs/snacket-interactions.md). The design, the security model, the tests and a two-device test plan are in [`docs/snacket-posts.md`](docs/snacket-posts.md). Local demo reactions, comments and drafts are kept separately per account and for the guest, so a shared browser never shows one supporter's local content to another.

- **Docs:** setup, the security model, the caching review, the e-mail template, SMTP requirements, future registration modes and a device test plan are in [`docs/authentication.md`](docs/authentication.md).
- **Migration:** [`supabase/migrations/`](supabase/migrations/), with pgTAP authorization tests in [`supabase/tests/`](supabase/tests/).
- **E-mail template:** [`supabase/templates/otp-code.html`](supabase/templates/otp-code.html).
- **Local setup:** copy `.env.example` to `.env` with the project URL and **publishable** key. Without them, the account UI hides itself.

## Installable app (PWA)

Supporters can put Djurgår’n on their home screen. It opens full-screen into the same mobile experience: bottom nav, mini-player, dialogs.

- **Manifest:** [`public/manifest.webmanifest`](public/manifest.webmanifest) sets standalone display and navy theme and background colours. Long-pressing the icon gives shortcuts to Lyssna, Stories and Snacket.
- **Icons:**
  - The striped DIF heart, with source files [`public/icons/icon.svg`](public/icons/icon.svg) and [`icon-maskable.svg`](public/icons/icon-maskable.svg). The maskable one keeps the motif inside the 80% safe zone.
  - The PNGs are rendered from those (192, 512, maskable 512, and `apple-touch-icon.png` at 180). Re-render them with any SVG→PNG tool if the SVGs change.
- **iOS:** `apple-mobile-web-app-*` meta tags. The status bar is `black-translucent`, so the page draws under it. `body` and the sticky header are padded by `env(safe-area-inset-top)`, with a navy strip behind the status bar.
- **Service worker** ([`public/sw.js`](public/sw.js)) is deliberately tiny and honest:
  - Page navigations always go to the network.
  - Only when that fails does it show [`offline.html`](public/offline.html), which says plainly that news, matches and podcasts need a connection.
  - It caches nothing else. API calls, audio streams and assets bypass it entirely, so stale news can never look current.
  - It's registered in production only. `/sw.js` is served `no-cache`, so updates land.
- **Install discovery:**
  - A quiet "Djurgår’n i fickan" card in the footer.
  - A single one-time hint on phones from the third visit. It's never shown again once it has appeared, and never while a podcast is playing.
  - An install guide with the browser's own dialog where available (Chrome, Edge, Samsung Internet), accurate Safari Share → *Lägg till på hemskärmen* steps on iPhone and iPad, and "open in Safari" for in-app browsers.
  - All of it is hidden once the app is installed.

We looked at `@vite-pwa/nuxt` (1.1.1). It still depends on `@nuxt/kit` 3 and needs vite-plugin-pwa 1.3+ for Vite 8. Its default Workbox precaching and navigation fallback would serve cached SSR pages, which is the stale-content risk we wanted to avoid. A manifest plus a ~40-line network-first worker does the job with nothing to de-configure.

## Deploying to Netlify

The repo is ready as is, through [`netlify.toml`](netlify.toml):

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node version | `22` (`NODE_VERSION` in `netlify.toml`, plus `.nvmrc`) |

On Netlify, Nitro detects the environment (`NETLIFY=true`) and builds with the **`netlify` preset**: static assets go to `dist/` and SSR runs in a Netlify Function (`.netlify/functions-internal/server`). You don't need to set a preset by hand or add a `nitro.preset` setting.

1. In Netlify, choose **Add new site → Import an existing project → GitHub → `dannesart/DIFTillIDie`**.
2. Leave the build settings as they are; they're read from `netlify.toml`.
3. Deploy.

To test the Netlify output locally, run `NETLIFY=true npm run build`.
