/*
 * Floating the `#` suggestions at the caret of a plain <textarea>: where in
 * the viewport a character of its text is, and where a popup next to it
 * fits. No rich-text editor: the textarea stays native, and a hidden copy
 * of it (same width, font and wrapping) tells us where the text lands.
 */

export interface Box { left: number, top: number, right: number, bottom: number }

/** Styles that decide where text wraps and lines fall. */
const COPIED = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
  'fontFeatureSettings', 'fontKerning', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing',
  'tabSize', 'direction',
] as const

/**
 * The viewport box of the character at `index` in the textarea (one line
 * high), with its own scrolling taken into account.
 */
export function caretBox(ta: HTMLTextAreaElement, index: number): Box {
  const doc = ta.ownerDocument
  const css = getComputedStyle(ta)
  const mirror = doc.createElement('div')
  const s = mirror.style
  for (const p of COPIED) s[p] = css[p]
  s.position = 'absolute'
  s.top = '0'
  s.left = '-9999px'
  s.visibility = 'hidden'
  s.whiteSpace = 'pre-wrap'
  s.overflowWrap = 'break-word'
  s.height = 'auto'
  // A scrolling textarea has a scrollbar taking width from the text.
  s.overflowY = ta.scrollHeight > ta.clientHeight ? 'scroll' : 'hidden'
  mirror.textContent = ta.value.slice(0, index)
  const mark = doc.createElement('span')
  mark.textContent = '​'
  mirror.append(mark, doc.createTextNode(ta.value.slice(index)))
  doc.body.append(mirror)
  const lh = Number.parseFloat(css.lineHeight)
  const height = Number.isFinite(lh) ? lh : Number.parseFloat(css.fontSize) * 1.2
  const x = mark.offsetLeft
  // The marker is as tall as the font; centre it in its line.
  const y = mark.offsetTop - (height - mark.offsetHeight) / 2
  mirror.remove()
  const r = ta.getBoundingClientRect()
  const left = r.left + x - ta.scrollLeft
  const top = r.top + y - ta.scrollTop
  return { left, top, right: left, bottom: top + height }
}

/** What's visible right now: the visual viewport, so a phone keyboard counts. */
export function visibleBox(win: Window = window): Box {
  const v = win.visualViewport
  if (!v) return { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight }
  return { left: v.offsetLeft, top: v.offsetTop, right: v.offsetLeft + v.width, bottom: v.offsetTop + v.height }
}

export interface Placement {
  /** Hidden when the anchor itself is out of sight (scrolled away). */
  side: 'below' | 'above' | 'hidden'
  left: number
  top: number
  width: number
  maxHeight: number
}

/**
 * Where a popup goes next to `anchor`: below it if it fits, else above if
 * that fits, else on the roomier side, shortened. Always inside `view`,
 * `margin` from its edges.
 *  - `clip`: the part of the page the anchor can be seen in (the textarea);
 *    an anchor scrolled outside it hides the popup rather than float it
 *    over unrelated text.
 */
export function placePopup(opts: {
  anchor: Box
  clip: Box
  view: Box
  /** The popup's natural height, unconstrained. */
  height: number
  /** Preferred width; narrowed to fit. */
  width: number
  gap?: number
  margin?: number
  maxHeight?: number
}): Placement {
  const { anchor, clip, view, gap = 6, margin = 8 } = opts
  const width = Math.max(0, Math.min(opts.width, view.right - view.left - 2 * margin))
  const visible = (b: Box) => b.bottom > b.top
  const seen = {
    left: Math.max(clip.left, view.left), top: Math.max(clip.top, view.top),
    right: Math.min(clip.right, view.right), bottom: Math.min(clip.bottom, view.bottom),
  }
  // Half a line of slack: a caret on the textarea's last visible line counts.
  const mid = (anchor.top + anchor.bottom) / 2
  if (!visible(seen) || mid < seen.top || mid > seen.bottom || anchor.left < seen.left - 1 || anchor.left > seen.right + 1) {
    return { side: 'hidden', left: 0, top: 0, width, maxHeight: 0 }
  }
  const want = Math.min(opts.height, opts.maxHeight ?? Infinity)
  const below = view.bottom - margin - (anchor.bottom + gap)
  const above = anchor.top - gap - (view.top + margin)
  const side = below >= want || below >= above ? 'below' : 'above'
  const maxHeight = Math.max(0, Math.min(want, side === 'below' ? below : above))
  const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - maxHeight
  // Start where the `#` is, nudged back in from the edges.
  const left = Math.min(Math.max(anchor.left - 12, view.left + margin), view.right - margin - width)
  return { side, left, top, width, maxHeight }
}
