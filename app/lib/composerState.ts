/*
 * The post composer closes its Story suggestions and search when focus
 * leaves it for something else, never when focus merely goes nowhere (a
 * click on a non-focusable spot, a control that removed itself, Safari not
 * focusing buttons).
 */

/** Where focus went when it left an element of the composer. */
export type FocusDestination = 'inside' | 'outside' | 'nowhere'

/** Classify a focusout: where did focus go, relative to the composer element? */
export function focusDestination(container: { contains: (n: Node | null) => boolean } | null, relatedTarget: EventTarget | null): FocusDestination {
  if (!relatedTarget) return 'nowhere'
  return container?.contains(relatedTarget as Node) ? 'inside' : 'outside'
}
