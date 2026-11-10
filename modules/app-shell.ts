import { defineNuxtModule, createResolver } from 'nuxt/kit'
import type { NuxtPage } from 'nuxt/schema'

/*
 * Mission #17: the site's routes, all laid out by the app shell (a
 * persistent sidebar, one view at a time, a rail with the next match and
 * episodes on desktop; the header and bottom nav on phones).
 * The shell is the parent route, so moving between its views keeps the
 * sidebars, and the one <audio> element in app.vue, in place:
 *
 *   /                    Home: Hem's overview, on every screen size
 *   /snacket, /stories,  a section's own page, on every screen size (Issue #16)
 *   /lyssna
 *   /laktaren/<handle>   a supporter's place on the stands
 */
const VIEWS = ['snacket', 'stories', 'lyssna'] as const

export default defineNuxtModule({
  meta: { name: 'app-shell' },
  setup(_, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const view = (name: string) => resolve(`../app/shell/views/${name}.vue`)

    nuxt.hook('pages:extend', (pages) => {
      pages.push({
        path: '/',
        file: resolve('../app/shell/AppShell.vue'),
        children: [
          { name: 'index', path: '', file: view('Home') },
          ...VIEWS.map((id): NuxtPage => ({ name: id, path: id, file: view(id[0]!.toUpperCase() + id.slice(1)) })),
          { name: 'laktaren-handle', path: 'laktaren/:handle()', file: view('Laktaren') },
        ],
      })
    })
  },
})
