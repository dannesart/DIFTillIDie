import { ref } from 'vue'

/*
 * Whether the post composer is open. Opening is an interaction: focus
 * arriving anywhere in the composer. Using its own controls (the sport
 * chips, the native "Koppla till en Story…" select, the attached Story's ✕)
 * never closes it, whatever the browser does with focus on the way.
 *
 * It closes only when:
 *  - the post is published (reset),
 *  - Escape is pressed while there's nothing worth keeping, or
 *  - focus moves to something outside the composer while there's nothing
 *    worth keeping. Focus going nowhere (a click on a non-focusable spot,
 *    a control that removed itself, Safari not focusing buttons) never
 *    closes it.
 */

/** Where focus went when it left an element of the composer. */
export type FocusDestination = 'inside' | 'outside' | 'nowhere'

export function createComposerOpen(isPristine: () => boolean) {
  const open = ref(false)
  return {
    open,
    /** Focus arrived somewhere in the composer. */
    enter() {
      open.value = true
    },
    leave(to: FocusDestination) {
      if (to === 'outside' && isPristine()) open.value = false
    },
    /** Returns whether the composer closed. */
    escape() {
      if (isPristine()) open.value = false
      return !open.value
    },
    /** After publishing: back to a closed, empty composer. */
    reset() {
      open.value = false
    },
  }
}

/** Classify a focusout: where did focus go, relative to the composer element? */
export function focusDestination(container: { contains: (n: Node | null) => boolean } | null, relatedTarget: EventTarget | null): FocusDestination {
  if (!relatedTarget) return 'nowhere'
  return container?.contains(relatedTarget as Node) ? 'inside' : 'outside'
}
