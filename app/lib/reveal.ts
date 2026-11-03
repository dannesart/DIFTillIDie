import { nextTick } from 'vue'

/*
 * Bringing a just-published post into view.
 *
 * Publishing collapses the composer and puts the post at the top of the
 * feed, and both only happen on Vue's next render. Measuring before that
 * scrolled to where the feed *used* to be: the composer then shrank, the
 * feed moved up and the post ended under the sticky header. So: wait for
 * the render, then scroll to the post itself.
 *
 * The space kept above it is CSS (`.scroll-below-header`: the header's
 * measured height plus the safe area), and so is the motion: html is
 * scroll-behavior: smooth, and auto under prefers-reduced-motion.
 */

export const postAnchor = (id: string) => `post-${id}`
export const FEED_ID = 'snacket-feed'

export async function revealPost(id: string, deps: { tick?: () => Promise<void>, doc?: Pick<Document, 'getElementById'> } = {}) {
  const { tick = nextTick, doc = document } = deps
  await tick()
  // Hidden by the sport filter? Then the top of the feed.
  const el = doc.getElementById(postAnchor(id)) ?? doc.getElementById(FEED_ID)
  // No `behavior`: the page's scroll-behavior decides (smooth, or instant for reduced motion).
  el?.scrollIntoView({ block: 'start' })
  return el
}
