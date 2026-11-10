import { DESKTOP_QUERY } from '~/lib/sectionLinks'

/*
 * Small viewport helpers shared by the floating controls (bottom nav,
 * mini-player): is a text field focused (so a phone keyboard is likely
 * open), and does a media query match. Both are false until mounted.
 */

const isField = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]')

/** True while a text field has focus — floating controls should step aside. */
export function useTyping() {
  const typing = ref(false)
  const onIn = (e: FocusEvent) => (typing.value = isField(e.target))
  const onOut = () => (typing.value = false)
  onMounted(() => {
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('focusin', onIn)
    document.removeEventListener('focusout', onOut)
  })
  return typing
}

export function useMedia(query: string) {
  const matches = ref(false)
  let mq: MediaQueryList | undefined
  const update = () => (matches.value = !!mq?.matches)
  onMounted(() => {
    mq = window.matchMedia(query)
    update()
    mq.addEventListener('change', update)
  })
  onBeforeUnmount(() => mq?.removeEventListener('change', update))
  return matches
}

/*
 * For the app shell, which has a desktop part and a phone part on the same
 * page (the sidebars or the header and bottom nav):
 * which of them to build.
 *  - Server HTML: both, since the server can't know the screen. Each part is
 *    then hydrated only on its own screen size (defineLazyHydrationComponent
 *    with DESKTOP_QUERY / MOBILE_QUERY); the other stays inert HTML, hidden by
 *    CSS: no setup, listeners or requests, until the window crosses over.
 *  - Built in the browser (moving between pages): only the one that fits,
 *    and the other when the window crosses over.
 */
export function useScreenParts() {
  const both = import.meta.server || useNuxtApp().isHydrating
  const desktop = ref<boolean | null>(both ? null : window.matchMedia(DESKTOP_QUERY).matches)
  let mq: MediaQueryList | undefined
  const update = () => (desktop.value = !!mq?.matches)
  onMounted(() => {
    if (both) return
    mq = window.matchMedia(DESKTOP_QUERY)
    update()
    mq.addEventListener('change', update)
  })
  onBeforeUnmount(() => mq?.removeEventListener('change', update))
  return {
    desktop: computed(() => desktop.value !== false),
    mobile: computed(() => desktop.value !== true),
  }
}
