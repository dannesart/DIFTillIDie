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
