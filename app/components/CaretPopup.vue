<script setup lang="ts">
import { type Placement, caretBox, placePopup, visibleBox } from '~/lib/caretPopup'

/*
 * A popup floating at a character of a native textarea (the `#` being
 * typed), so opening and closing it never moves the page. It follows the
 * text as it wraps and scrolls, and the page as it scrolls and resizes,
 * including a phone keyboard taking half the screen. Below the line if it
 * fits, otherwise above.
 *
 * Teleported out of the composer, whose surroundings may blur their
 * backdrop (turning `position: fixed` into "fixed to the card"): into the
 * open modal <dialog> the composer is in, since everything outside one is
 * inert and beneath it, or else to the end of <body>.
 * Pressing in it never takes focus from the textarea.
 */
const props = defineProps<{ textarea: HTMLTextAreaElement | null, at: number, text: string }>()

const target = computed(() => props.textarea?.closest('dialog') ?? '#teleports')

const WIDTH = 352
const MAX_HEIGHT = 320

const el = useTemplateRef<HTMLElement>('el')
const place = ref<Placement | null>(null)

function update() {
  const ta = props.textarea
  const box = el.value
  if (!ta || !box) return
  const r = ta.getBoundingClientRect()
  place.value = placePopup({
    anchor: caretBox(ta, props.at),
    clip: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    view: visibleBox(),
    height: box.scrollHeight,
    width: WIDTH,
    maxHeight: MAX_HEIGHT,
  })
}

let frame = 0
function schedule() {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0
    update()
  })
}

const style = computed(() => {
  const p = place.value
  if (!p || p.side === 'hidden') return { visibility: 'hidden' as const, left: '0px', top: '0px', width: `${WIDTH}px` }
  return { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` }
})

// Typing can rewrap the `#word`; new suggestions change the height.
watch(() => [props.at, props.text], () => nextTick(update))

let observer: ResizeObserver | undefined
onMounted(() => {
  update()
  window.addEventListener('scroll', schedule, { capture: true, passive: true })
  window.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('scroll', schedule)
  observer = new ResizeObserver(schedule)
  if (props.textarea) observer.observe(props.textarea)
  if (el.value) observer.observe(el.value)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('scroll', schedule, { capture: true })
  window.removeEventListener('resize', schedule)
  window.visualViewport?.removeEventListener('resize', schedule)
  window.visualViewport?.removeEventListener('scroll', schedule)
  observer?.disconnect()
})
</script>

<template>
  <Teleport :to="target">
    <!--
      mousedown.prevent: focus (and the phone keyboard) stays in the textarea.
      The one scrolling area, and only when a phone keyboard leaves too little room for three.
    -->
    <div
      ref="el"
      class="fixed z-[60] overflow-y-auto overscroll-contain rounded-2xl border border-white/12 bg-navy-950/95 p-1 shadow-[0_24px_60px_-20px_rgb(3_9_21/0.95)] backdrop-blur-xl"
      :style="style"
      :data-side="place?.side"
      @mousedown.prevent
    >
      <slot />
    </div>
  </Teleport>
</template>
