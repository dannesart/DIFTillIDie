# Djurgår’n tills jag dör

A digital home for Djurgården supporters, covering football and hockey: stories with their sources kept intact, the supporter feed *Snacket på stan*, and podcasts and videos.

> **Demo version.** Every outlet, headline, person and match is invented, and the app says so on screen. Anything a visitor writes, reacts to or comments on is saved only in their own browser (`localStorage`).

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
```

## Domain

The vocabulary is kept small, in [`shared/types/domain.ts`](shared/types/domain.ts):

- **Story**: an event or subject. Its `title` and `about` are our neutral description, not a claim made by any source.
- **SourceArticle**: one outlet's article about a Story. It keeps its own headline, URL and attribution and is never merged with other sources.
- **Post**: a supporter's post in Snacket, with reactions, comments, @mentions, #tags and an optional attached Story.

The demo content lives in [`app/data/`](app/data/). The timestamps are relative and are fixed once on the server (`useDemoNow`), so SSR and hydration agree.

## Things to try

- **Allt / Fotboll / Hockey** in the header filters the whole page: stories, feed and next match.
- **Source pills** on a Story show each source's own headline.
- **"Snackas om i N inlägg"** on a Story filters the feed to posts about it. An attached Story inside a post scrolls back to that Story and highlights it.
- **Hetast / Nyast på stan.** "Hetast" is engagement cooled by age, so the order changes as you react.
- **Click an @handle** to mention that person in the composer. **Click a #tag** to filter the feed.
- **"Lägg i kalendern"** downloads a real `.ics` file for the (demo) match.
- After 23:00 the night sky comes out, and *Djurgår’n by Night* moves to the top.
- Type **D-I-F** anywhere on the page.

## Podcasts and video

`app/data/media.ts` links to real search pages on Spotify, Apple Podcasts and YouTube, because we haven't verified the official show and channel IDs yet. Once you have a verified ID, add `embed` to the item:

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
