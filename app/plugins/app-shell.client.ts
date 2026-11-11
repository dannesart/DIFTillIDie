import { legacyTarget } from '~/lib/sectionLinks'

/*
 * The one-page front page's old addresses (/#snacket, /#post-…), still in
 * shared links, bookmarks and installed apps' shortcuts, go to the pages
 * that have them now (see legacyTarget), on every screen size: links
 * followed in the app as a redirect (no extra history entry), and an address
 * opened directly by replacing it once the page has hydrated (so the
 * server's HTML is hydrated as it was rendered, and Hem shows briefly).
 */
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()

  router.beforeEach((to) => {
    if (nuxtApp.isHydrating) return
    return legacyTarget(to.path, to.hash) ?? undefined
  })
  onNuxtReady(() => {
    const { path, hash } = router.currentRoute.value
    const target = legacyTarget(path, hash)
    if (target) void router.replace(target)
  })
})
