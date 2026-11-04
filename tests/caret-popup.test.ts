import { describe, expect, it } from 'vitest'
import { type Box, placePopup } from '../app/lib/caretPopup'

/* Where the `#` suggestions float next to the caret (caretBox itself needs a real browser). */

const VIEW: Box = { left: 0, top: 0, right: 400, bottom: 800 }
const TEXTAREA: Box = { left: 40, top: 300, right: 380, bottom: 380 }
const at = (left: number, top: number): Box => ({ left, top, right: left, bottom: top + 26 })
const place = (anchor: Box, o: Partial<Parameters<typeof placePopup>[0]> = {}) =>
  placePopup({ anchor, clip: TEXTAREA, view: VIEW, height: 240, width: 352, maxHeight: 320, ...o })

describe('placing the suggestions at the caret', () => {
  it('below the line when it fits, starting at the `#`', () => {
    expect(place(at(120, 320), { width: 200 })).toEqual({ side: 'below', left: 108, top: 352, width: 200, maxHeight: 240 })
  })

  it('flips above when there is no room below', () => {
    const p = place(at(120, 600), { clip: { ...TEXTAREA, top: 580, bottom: 660 } })
    expect([p.side, p.top + p.maxHeight]).toEqual(['above', 594])
    expect(p.maxHeight).toBe(240)
  })

  it('a phone keyboard: the visible area is what counts', () => {
    // 844 tall, keyboard up: only the top 450 is visible.
    const view = { left: 0, top: 0, right: 390, bottom: 450 }
    const p = place(at(60, 330), { view })
    expect(p.side).toBe('above')
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('no room for all of it either way: the roomier side, shortened (the list scrolls)', () => {
    const view = { left: 0, top: 0, right: 400, bottom: 300 }
    const p = place(at(60, 100), { view, clip: { ...TEXTAREA, top: 80, bottom: 160 } })
    expect(p).toMatchObject({ side: 'below', top: 132, maxHeight: 160 })
  })

  it('stays inside the viewport sideways, and narrows on a small screen', () => {
    expect(place(at(370, 320)).left).toBe(400 - 8 - 352)
    expect(place(at(2, 320), { clip: { ...TEXTAREA, left: 0 } }).left).toBe(8)
    const narrow = place(at(100, 320), { view: { ...VIEW, right: 320 }, clip: { ...TEXTAREA, right: 300 } })
    expect([narrow.width, narrow.left]).toEqual([304, 8])
  })

  it('never taller than its cap', () => {
    expect(place(at(120, 320), { height: 900 }).maxHeight).toBe(320)
  })

  it('a `#` scrolled out of the textarea, or the page, hides it instead of floating over other text', () => {
    expect(place(at(120, 260)).side).toBe('hidden')
    expect(place(at(120, 390)).side).toBe('hidden')
    expect(place(at(120, -40), { clip: { ...TEXTAREA, top: -60, bottom: 20 } }).side).toBe('hidden')
  })

  it('the visual viewport may be scrolled (pinch zoom, iOS keyboard)', () => {
    const view = { left: 0, top: 500, right: 400, bottom: 900 }
    const p = place(at(120, 560), { view, clip: { ...TEXTAREA, top: 540, bottom: 620 } })
    expect(p).toMatchObject({ side: 'below', top: 592 })
  })
})
