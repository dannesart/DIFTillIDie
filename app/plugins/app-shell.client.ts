import { DESKTOP_QUERY, desktopTarget } from '~/lib/sectionLinks'

/*
 * With the app shell on desktop, the front page's sections are views of
 * their own. Links to them stay the classic ones everywhere (/#snacket),
 * since phones keep the long front page; on desktop they are sent to the
 * view instead (see desktopTarget): links followed in the app, and an
 * address opened directly or shared, once the page has hydrated (so the
 * server's HTML is hydrated as it was rendered).
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (!useAppConfig().appShell) return
  const router = useRouter()
  const desktop = () => window.matchMedia(DESKTOP_QUERY).matches

  router.beforeEach((to) => {
    if (nuxtApp.isHydrating || !desktop()) return
    return desktopTarget(to.path, to.hash) ?? undefined
  })
  onNuxtReady(() => {
    const { path, hash } = router.currentRoute.value
    const target = desktop() && desktopTarget(path, hash)
    if (target) void router.replace(target)
  })
})
