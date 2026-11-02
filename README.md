# Djurgår’n tills jag dör

A digital home for Djurgården supporters, covering football and hockey: stories with their sources kept intact, the supporter feed *Snacket på stan*, and podcasts and videos.

> **Partly real, partly demo.**
> - **Real:** Stories, fetched from the publishers' own RSS feeds, and *Djurgårn by night* episodes.
> - **Invented:** the people and posts in *Snacket på stan*, and the next match. The page labels both as demo.
>
> Anything a visitor writes, reacts to or comments on is saved only in their own browser (`localStorage`). Search engines are kept out for now: a `noindex` meta tag plus an `X-Robots-Tag` header.

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
- **Post**: a supporter's post in Snacket, with reactions, comments, @mentions, #tags and an optional attached Story.

Demo content (posts, the match) lives in [`app/data/`](app/data/). The timestamps are relative and are fixed once on the server (`useDemoNow`), so SSR and hydration agree.

## Things to try

- **Allt / Fotboll / Hockey** in the header filters the whole page: stories, feed and next match.
- **Source pills** link straight to each original article.
- **"Snackas om i N inlägg"** on a Story filters the feed to posts about it. An attached Story inside a post scrolls back to that Story and highlights it.
- **Hetast / Nyast på stan.** "Hetast" is engagement cooled by age, so the order changes as you react.
- **Click an @handle** to mention that person in the composer. **Click a #tag** to filter the feed.
- **"Lägg i kalendern"** downloads a real `.ics` file for the (demo) match.
- After 23:00 the night sky comes out, and the podcast gets a 🌙 badge.
- Type **D-I-F** anywhere on the page.

## News feeds

| Feed | Scope | Status (2026-11-02) |
|---|---|---|
| [Bollsvenskan, DIF](https://bollsvenskan.se/feed/djurgardens-if) | Team feed, every item kept | ✅ 20 items, all about DIF |
| [Sportbladet, fotboll](https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/) | Broad, filtered | ✅ 39 items, 3 about DIF |
| [Sportbladet, hockey](https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/hockey/) | Broad, filtered | ✅ 39 items, 1 about DIF |
| [Djurgårn by night](https://feed.pod.space/djurgarnbynight) | Podcast | ✅ 99 episodes, playable MP3s |

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

## Podcasts and video

*Djurgårn by night* plays in a native player. The audio streams from the MP3 enclosure the show publishes in its RSS feed for podcast players, credited to the show and linked to its episode page. If the feed can't be reached, the old card with search links comes back.

`app/data/media.ts` links the remaining shows and channels (DIFpodden, YouTube) to real search pages on Spotify, Apple Podcasts and YouTube, because we haven't verified their official IDs yet. Once you have a verified ID, add `embed` to the item:

- Spotify: `https://open.spotify.com/embed/show/<id>`
- YouTube: `https://www.youtube-nocookie.com/embed/<videoId>` or `.../embed/videoseries?list=<playlistId>`

The card then shows a click-to-load player. Nothing is loaded from Spotify or YouTube until the visitor asks for it.

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
