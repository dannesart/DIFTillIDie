import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },

  modules: ['@nuxt/fonts'],
  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
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
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
