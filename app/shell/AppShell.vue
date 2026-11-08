<script setup lang="ts">
import { DESKTOP_QUERY, MOBILE_QUERY } from '~/lib/sectionLinks'

/*
 * Mission #17 — the app shell: the parent of every page (see
 * modules/app-shell.ts).
 *
 * From lg up: a persistent sidebar (sections, sport, you), one view at a
 * time in the middle (/, /snacket, …), and from xl a contextual rail (next
 * match, newest episodes). Every view is a real address, and moving between
 * them is client-side, so the one <audio> element in app.vue keeps playing.
 * Below lg the site's own header, front page and bottom nav are kept.
 *
 * The server renders the desktop and phone parts both; each hydrates only on
 * its own screen size (see useScreenParts), so a phone never runs the
 * sidebars and a desktop never runs the header or bottom nav.
 *
 * Same data as the front page: Stories, podcasts and fixtures fetched during
 * SSR; Snacket and drafts in the browser.
 */
const ShellNav = defineLazyHydrationComponent('mediaQuery', () => import('~/shell/ShellNav.vue'))
const ShellRail = defineLazyHydrationComponent('mediaQuery', () => import('~/shell/ShellRail.vue'))
const PilotBanner = defineLazyHydrationComponent('mediaQuery', () => import('~/components/PilotBanner.vue'))
const AppHeader = defineLazyHydrationComponent('mediaQuery', () => import('~/components/AppHeader.vue'))
const MobileNav = defineLazyHydrationComponent('mediaQuery', () => import('~/components/MobileNav.vue'))

const { load } = useSnacket()
const { load: loadDrafts } = useCompose()
onMounted(() => {
  load()
  loadDrafts()
})
await Promise.all([useNews(), usePodcasts(), useFixtures()])

const links = useSectionLinks()
const screen = useScreenParts()

// Snacket and Stories bring their own side columns: the rail waits for a wider screen there.
const roomy = computed(() => links.value.here('snacket') || links.value.here('stories'))
// Lyssna already is the podcasts.
const episodes = computed(() => !links.value.here('lyssna'))

/*
 * One vertical scrollbar: the page's. The rail is a sticky column, not a
 * scroll box of its own. While it fits the window it sticks by its top; when
 * it is taller (a short window) it sticks by its bottom instead (top = window
 * height − its height), so it scrolls along with the page until its last item
 * is in view, and nothing in it is ever out of reach.
 */
const rail = useTemplateRef<HTMLElement>('rail')
const railHeight = ref(0)
let railObserver: ResizeObserver | undefined
onMounted(() => {
  railObserver = new ResizeObserver(([entry]) => (railHeight.value = entry!.target.getBoundingClientRect().height))
  // The rail may only be built later (a phone-sized window widened).
  watch(rail, (el, old) => {
    if (old) railObserver?.unobserve(old)
    if (el) railObserver?.observe(el)
  }, { immediate: true })
})
onBeforeUnmount(() => railObserver?.disconnect())
const railTop = computed(() => `min(0px, calc(100dvh - ${railHeight.value}px))`)

// The shell's own scrollbar colours (main.css), on desktop only; gone again when you leave it.
useHead({ htmlAttrs: { class: 'app-shell' } })

// Past the sidebar (or the header), without moving the address.
function skipToContent() {
  document.getElementById('innehall')?.focus()
}
</script>

<template>
  <div class="relative min-h-dvh overflow-x-clip lg:grid lg:grid-cols-[var(--shell-nav-w)_minmax(0,1fr)]" :class="roomy ? '2xl:grid-cols-[var(--shell-nav-w)_minmax(0,1fr)_var(--shell-rail-w)]' : 'xl:grid-cols-[var(--shell-nav-w)_minmax(0,1fr)_var(--shell-rail-w)]'">
    <a
      href="#innehall"
      class="sr-only rounded-full bg-guld px-5 py-2.5 text-sm font-bold text-navy-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-[calc(env(safe-area-inset-top)+1rem)] focus:z-[60]"
      @click.prevent="skipToContent"
    >Hoppa till innehållet</a>

    <!-- Phones and tablets: the site as it is -->
    <div v-if="screen.mobile.value" class="lg:hidden">
      <PilotBanner :hydrate-on-media-query="MOBILE_QUERY" />
      <AppHeader :hydrate-on-media-query="MOBILE_QUERY" />
    </div>

    <!-- Fits any ordinary window; scrolls on its own only when it can't (a short window, with a podcast playing) -->
    <aside v-if="screen.desktop.value" class="shell-scroll sticky top-0 hidden h-dvh overflow-y-auto border-r border-white/8 bg-natt/70 lg:block">
      <ShellNav :hydrate-on-media-query="DESKTOP_QUERY" />
    </aside>

    <div class="min-w-0">
      <main id="innehall" tabindex="-1" class="focus:outline-none">
        <NuxtPage :page-key="r => r.path" />
      </main>
      <!-- On every screen: it says this is a supporter project, not the club's channel, and whose the content is -->
      <AppFooter />
    </div>

    <aside
      v-if="screen.desktop.value"
      class="hidden border-l border-white/8 bg-natt/40"
      :class="roomy ? '2xl:block' : 'xl:block'"
      aria-label="På gång"
    >
      <div ref="rail" class="sticky" :style="{ top: railTop }">
        <ShellRail :episodes="episodes" :hydrate-on-media-query="DESKTOP_QUERY" />
      </div>
    </aside>

    <ComposeDialog />
    <!-- Opened from the footer's install card, which is on every view -->
    <InstallGuide />
    <MobileNav v-if="screen.mobile.value" :hydrate-on-media-query="MOBILE_QUERY" />
    <StripeBurst />
  </div>
</template>
