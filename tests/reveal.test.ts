import { describe, expect, it } from 'vitest'
import { FEED_ID, postAnchor, revealPost } from '../app/lib/reveal'

/*
 * Regression: after publishing, the feed was measured before the composer
 * collapsed and the post rendered, so it ended up under the sticky header.
 */

function page() {
  const scrolled: { id: string, opts: unknown }[] = []
  const nodes = new Map<string, { id: string, scrollIntoView: (o: unknown) => void }>()
  const add = (id: string) => nodes.set(id, { id, scrollIntoView: opts => scrolled.push({ id, opts }) })
  const doc = { getElementById: (id: string) => (nodes.get(id) ?? null) as unknown as HTMLElement | null }
  return { scrolled, add, doc }
}

describe('revealing a just-published post', () => {
  it('waits for the render, then scrolls to the post itself (not the feed)', async () => {
    const p = page()
    p.add(FEED_ID)
    // The new post (and the collapsed composer) only exist after the render.
    const tick = async () => { p.add(postAnchor('new')) }
    await revealPost('new', { tick, doc: p.doc })
    expect(p.scrolled.map(s => s.id)).toEqual([postAnchor('new')])
  })

  it('leaves the motion to CSS: no behavior, so reduced motion is respected', async () => {
    const p = page()
    p.add(postAnchor('new'))
    await revealPost('new', { tick: async () => {}, doc: p.doc })
    expect(p.scrolled[0]!.opts).toEqual({ block: 'start' })
  })

  it('a post hidden by the sport filter falls back to the top of the feed', async () => {
    const p = page()
    p.add(FEED_ID)
    await revealPost('elsewhere', { tick: async () => {}, doc: p.doc })
    expect(p.scrolled.map(s => s.id)).toEqual([FEED_ID])
  })
})
