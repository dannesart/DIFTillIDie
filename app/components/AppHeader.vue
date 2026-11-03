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

const nav = [
  { href: '#stories', label: 'Stories' },
  { href: '#snacket', label: 'Snacket' },
  { href: '#lyssna', label: 'Lyssna & titta' },
]
</script>

<template>
  <header
    ref="header"
    class="sticky top-[env(safe-area-inset-top)] z-40 transition-[background-color,border-color,backdrop-filter] duration-300"
    :class="scrolled ? 'border-b border-white/8 bg-navy-950/85 backdrop-blur-xl' : 'border-b border-transparent'"
  >
    <div class="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
      <a href="#" class="group flex items-center gap-2.5" aria-label="Djurgår'n tills jag dör – till toppen">
        <span class="stripes block h-8 w-6 rounded-[5px] [--stripe:4px] transition-transform duration-500 ease-spring group-hover:-rotate-6 group-hover:scale-110" />
        <span class="leading-none">
          <span class="block font-display text-xl font-bold tracking-tight">Djurgår’n</span>
          <span class="block font-display text-[0.8rem] italic text-himmel">tills jag dör</span>
        </span>
      </a>

      <nav class="ml-6 hidden items-center gap-6 text-sm font-medium text-krita-dim lg:flex" aria-label="Sektioner">
        <a v-for="n in nav" :key="n.href" :href="n.href" class="transition hover:text-krita">{{ n.label }}</a>
      </nav>

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
