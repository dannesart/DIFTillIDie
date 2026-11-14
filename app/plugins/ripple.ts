import type { Directive } from 'vue'

/*
 * v-ripple: a soft glow that spreads from where you pressed, plus a small
 * pressed state (CSS: .ripple-host in main.css). Decorative only: it never
 * waits, prevents or delays the click. Off with prefers-reduced-motion.
 *
 *   <button v-ripple>           glow in the control's own text colour
 *   <a v-ripple="'himmel'">     or in a theme colour (--color-<name>)
 *
 * The host must be position: relative (the glow layer is absolute, inset 0,
 * clipped to the host's rounded corners).
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function spawn(el: HTMLElement, x?: number, y?: number) {
  if (reduced()) return
  let layer = el.querySelector<HTMLElement>(':scope > .ripple-layer')
  if (!layer) {
    layer = document.createElement('span')
    layer.className = 'ripple-layer'
    layer.setAttribute('aria-hidden', 'true')
    el.appendChild(layer)
  }
  const box = el.getBoundingClientRect()
  const size = Math.max(box.width, box.height) * 1.4
  const cx = (x ?? box.left + box.width / 2) - box.left
  const cy = (y ?? box.top + box.height / 2) - box.top
  const dot = document.createElement('span')
  dot.className = 'ripple-dot'
  dot.style.cssText = `width:${size}px;height:${size}px;left:${cx - size / 2}px;top:${cy - size / 2}px`
  dot.addEventListener('animationend', () => dot.remove())
  layer.appendChild(dot)
  // Rapid clicks: keep the newest few, so repeated taps stay light.
  while (layer.children.length > 3) layer.firstElementChild!.remove()
}

interface Host extends HTMLElement {
  _ripple?: { down: (e: PointerEvent) => void, cancel: () => void, key: (e: MouseEvent) => void, timer?: number }
}

const ripple: Directive<Host, string | undefined> = {
  mounted(el, { value }) {
    el.classList.add('ripple-host')
    if (value) el.style.setProperty('--ripple', `var(--color-${value})`)
    const state: NonNullable<Host['_ripple']> = {
      down(e) {
        if (e.button !== 0) return
        // A touch might be the start of a scroll: wait a moment, and let a cancelled touch show nothing.
        if (e.pointerType === 'touch') state.timer = window.setTimeout(() => spawn(el, e.clientX, e.clientY), 60)
        else spawn(el, e.clientX, e.clientY)
      },
      cancel() {
        window.clearTimeout(state.timer)
      },
      // Enter/Space: a click with no pointer (detail 0) glows from the middle.
      key(e) {
        if (e.detail === 0) spawn(el)
      },
    }
    el._ripple = state
    el.addEventListener('pointerdown', state.down, { passive: true })
    el.addEventListener('pointercancel', state.cancel, { passive: true })
    el.addEventListener('click', state.key, { passive: true })
  },
  beforeUnmount(el) {
    const s = el._ripple
    if (!s) return
    window.clearTimeout(s.timer)
    el.removeEventListener('pointerdown', s.down)
    el.removeEventListener('pointercancel', s.cancel)
    el.removeEventListener('click', s.key)
  },
  getSSRProps: () => ({}),
}

export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.vueApp.directive('ripple', ripple)
})
