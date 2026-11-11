<script setup lang="ts">
import type { SportFilter } from '~/composables/useDemo'

const { sport } = useSport()
const options: { value: SportFilter, label: string }[] = [
  { value: 'alla', label: 'Allt' },
  { value: 'fotboll', label: 'Fotboll' },
  { value: 'hockey', label: 'Hockey' },
]

const scrolled = ref(false)
const onScroll = () => (scrolled.value = window.scrollY > 24)

// Publish the real height as --header-h, so content scrolled into view can stop below it.
const header = useTemplateRef<HTMLElement>('header')
let resize: ResizeObserver | undefined
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  if (header.value && 'ResizeObserver' in window) {
    const el = header.value
    resize = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`))
    resize.observe(el)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  resize?.disconnect()
})

// The pages are in the bottom nav. The logo leads to Hem; on Hem, back to its top.
const route = useRoute()
const onHome = computed(() => route.path === '/')
function home(e: MouseEvent) {
  if (!onHome.value || route.hash) return
  e.preventDefault()
  window.scrollTo({ top: 0 })
}
</script>

<template>
  <header
    ref="header"
    class="sticky top-[env(safe-area-inset-top)] z-40 transition-[background-color,border-color,backdrop-filter] duration-300"
    :class="scrolled ? 'border-b border-white/8 bg-navy-950/85 backdrop-blur-xl' : 'border-b border-transparent'"
  >
    <!-- Wraps when the logo and the sport filter don't fit side by side (a small screen, larger text): the filter takes its own row instead of being pushed off the edge (Issue #16) -->
    <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
      <NuxtLink to="/" data-nav-focus class="group flex items-center gap-2.5" :aria-label="onHome ? 'Djurgår’n tills jag dör – till toppen' : 'Djurgår’n tills jag dör – till startsidan'" @click="home">
        <span class="stripes block h-8 w-6 rounded-[5px] [--stripe:4px] transition-transform duration-500 ease-spring group-hover:-rotate-6 group-hover:scale-110" />
        <span class="leading-none">
          <span class="block font-display text-xl font-bold tracking-tight">Djurgår’n</span>
          <span class="block font-display text-[0.8rem] italic text-himmel">tills jag dör</span>
        </span>
      </NuxtLink>

      <div class="ml-auto flex rounded-full border border-white/10 bg-navy-900/80 p-1 text-xs font-semibold" role="radiogroup" aria-label="Välj sport">
        <button
          v-for="o in options"
          :key="o.value"
          role="radio"
          :aria-checked="sport === o.value"
          class="relative rounded-full px-3 py-1.5 transition duration-300 sm:px-4"
          :class="sport === o.value ? 'bg-himmel text-navy-950 shadow-[0_4px_20px_-4px_rgb(95_176_236/0.7)]' : 'text-krita-dim hover:text-krita'"
          @click="sport = o.value"
        >
          {{ o.label }}
        </button>
      </div>
      <!-- On phones and tablets the account lives in the bottom nav -->
      <AccountButton class="hidden lg:grid" />
    </div>
  </header>
</template>
