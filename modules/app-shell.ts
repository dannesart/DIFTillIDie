import { defineNuxtModule, createResolver } from 'nuxt/kit'
import type { NuxtPage } from 'nuxt/schema'

/*
 * Mission #17: the desktop app shell (a persistent sidebar, one view at a
 * time, a rail with the next match and episodes). Two switches, both read
 * at build time:
 *
 *  - APP_SHELL=1 promotes it: the front page and supporters' pages are laid
 *    out by the shell, and desktop gets a view per section (/snacket,
 *    /stories, /lyssna). Phones keep today's front page and navigation.
 *    Without it the site is exactly as before, and the view addresses lead
 *    to the front page's sections instead, so links shared while it was on
 *    keep working after switching it off.
 *  - The development prototype at /prototyp/…: under `nuxt dev`, or in a
 *    build made with APP_SHELL_PREVIEW=1. A normal build has no such routes.
 *
 * The flag reaches the app as appConfig.appShell (see nuxt.config.ts).
 */
const VIEWS = ['snacket', 'stories', 'lyssna'] as const

export default defineNuxtModule({
  meta: { name: 'app-shell' },
  setup(_, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const shellFile = resolve('../app/shell/AppShell.vue')
    const view = (name: string) => resolve(`../app/shell/views/${name}.vue`)
    const shell = !!nuxt.options.appConfig.appShell
    const prototype = nuxt.options.dev || process.env.APP_SHELL_PREVIEW === '1'

    const rules = (nuxt.options.routeRules ||= {})
    for (const id of VIEWS) {
      rules[`/${id}`] = shell
        // The same public HTML for everyone, like the front page.
        ? { ...rules[`/${id}`], isr: 300 }
        : { ...rules[`/${id}`], redirect: { to: `/#${id}`, statusCode: 302 } }
    }

    nuxt.hook('pages:extend', (pages) => {
      if (shell) {
        // The front page and supporters' pages move into the shell, at the same addresses.
        const replaced = ['/', '/laktaren/:handle()']
        for (const path of replaced) {
          const i = pages.findIndex(p => p.path === path)
          if (i === -1) throw new Error(`app-shell: expected a page at ${path}`)
          pages.splice(i, 1)
        }
        pages.push({
          path: '/',
          file: shellFile,
          children: [
            { name: 'index', path: '', file: view('Home') },
            ...VIEWS.map((id): NuxtPage => ({ name: id, path: id, file: view(id[0]!.toUpperCase() + id.slice(1)) })),
            { name: 'laktaren-handle', path: 'laktaren/:handle()', file: view('Laktaren') },
          ],
        })
      }
      if (prototype) {
        pages.push({
          path: '/prototyp',
          file: shellFile,
          children: [
            { name: 'prototyp', path: '', file: view('Hem') },
            ...VIEWS.map((id): NuxtPage => ({ name: `prototyp-${id}`, path: id, file: view(id[0]!.toUpperCase() + id.slice(1)) })),
            { name: 'prototyp-laktaren', path: 'laktaren/:handle', file: view('Laktaren') },
          ],
        })
      }
    })
  },
})
