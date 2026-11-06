import { defineNuxtModule, createResolver } from 'nuxt/kit'

/*
 * Mission #17: an experimental desktop app-shell layout, as a preview next to
 * the real site. It is a UX experiment, not an approved redesign, so its
 * routes (/prototyp/…) exist only under `nuxt dev`, or in a build made with
 * APP_SHELL_PREVIEW=1 (e.g. a branch deploy to compare in the browser). A
 * normal production build has no such routes: /prototyp is a 404 there.
 */
export default defineNuxtModule({
  meta: { name: 'app-shell-preview' },
  setup(_, nuxt) {
    if (!nuxt.options.dev && process.env.APP_SHELL_PREVIEW !== '1') return
    const { resolve } = createResolver(import.meta.url)
    const view = (name: string) => resolve(`../app/prototype/views/${name}.vue`)
    nuxt.hook('pages:extend', (pages) => {
      pages.push({
        path: '/prototyp',
        file: resolve('../app/prototype/AppShell.vue'),
        children: [
          { name: 'prototyp', path: '', file: view('Hem') },
          { name: 'prototyp-snacket', path: 'snacket', file: view('Snacket') },
          { name: 'prototyp-stories', path: 'stories', file: view('Stories') },
          { name: 'prototyp-lyssna', path: 'lyssna', file: view('Lyssna') },
          { name: 'prototyp-laktaren', path: 'laktaren/:handle', file: view('Laktaren') },
        ],
      })
    })
  },
})
