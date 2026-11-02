import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },

  modules: ['@nuxt/fonts'],
  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  routeRules: {
    // Fictional posts and matches are public: keep the site out of search results for now.
    '/**': { headers: { 'x-robots-tag': 'noindex, nofollow' } },
    // On Netlify, `isr` becomes durable CDN caching (stale-while-revalidate),
    // so publishers are fetched at most every few minutes, not per visit.
    '/': { isr: 300 },
    '/api/news': { isr: 600 },
    '/api/podcast': { isr: 600 },
    '/api/fixtures': { isr: 900 },
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
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
