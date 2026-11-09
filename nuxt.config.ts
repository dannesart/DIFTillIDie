import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },

  // The site's routes, laid out by the app shell (see the module).
  modules: ['@nuxt/fonts', './modules/app-shell'],
  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  // The routes come from modules/app-shell.ts, not from a pages/ directory.
  pages: true,

  runtimeConfig: {
    // Server-only: signs Story captures (see server/lib/capture.ts). Set
    // NUXT_STORY_CAPTURE_KEY_ID / NUXT_STORY_CAPTURE_KEY; never under `public`.
    storyCapture: { keyId: '', key: '' },
    public: {
      // Set NUXT_PUBLIC_SUPABASE_URL / NUXT_PUBLIC_SUPABASE_KEY (see .env.example).
      // Only the *publishable* key belongs here — it's meant for browsers.
      supabaseUrl: '',
      supabaseKey: '',
    },
  },

  routeRules: {
    // Fictional posts and matches are public: keep the site out of search results for now.
    '/**': { headers: { 'x-robots-tag': 'noindex, nofollow' } },
    // On Netlify, `isr` becomes durable CDN caching (stale-while-revalidate),
    // so publishers are fetched at most every few minutes, not per visit.
    // Shared CDN HTML is safe because sign-in lives entirely in the browser:
    // the server never sees a session, so this page is identical for everyone.
    '/': { isr: 300 },
    // Desktop's section views: the same public HTML for everyone, like the front page.
    '/snacket': { isr: 300 },
    '/stories': { isr: 300 },
    '/lyssna': { isr: 300 },
    // A supporter's page: the same public shell for everyone; the profile and wall load in the browser.
    '/laktaren/**': { isr: 300 },
    '/api/news': { isr: 600 },
    '/api/podcast': { isr: 600 },
    '/api/fixtures': { isr: 900 },
    // The service worker must always be re-checked, or updates would never land.
    '/sw.js': { headers: { 'cache-control': 'no-cache' } },
    '/manifest.webmanifest': { headers: { 'cache-control': 'public, max-age=3600' } },
  },

  fonts: {
    defaults: {
      weights: [400, 500, 600, 700, 800, 900],
      styles: ['normal', 'italic'],
      subsets: ['latin', 'latin-ext'],
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'sv' },
      title: 'Djurgår’n tills jag dör',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Ett digitalt hem för Djurgårdare – fotboll och hockey, nyheter, snack, poddar och klipp.' },
        { name: 'theme-color', content: '#061229' },
        // Installable on the home screen (see public/manifest.webmanifest).
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Djurgår’n' },
        // Navy all the way up: the page draws under the iOS status bar (safe-area padded).
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
})
