<script setup lang="ts">
import ShellNav from './ShellNav.vue'
import ShellRail from './ShellRail.vue'

/*
 * Mission #17 — Djurgår'n, reimagined: an experimental desktop app shell.
 * NOT the site's design; a preview to compare with it (development only, see
 * modules/app-shell-preview.ts).
 *
 * From lg up: a persistent sidebar (sections, sport, you), one view at a time
 * in the middle (/prototyp, /prototyp/snacket, …), and from xl a contextual
 * rail (next match, newest episodes). Every view is a real address, and
 * moving between them is client-side, so the one <audio> element in app.vue
 * keeps playing. Below lg the site's own header and bottom nav are kept.
 *
 * Same data as the front page: Stories, podcasts and fixtures fetched during
 * SSR; Snacket and drafts in the browser.
 */
const { load } = useSnacket()
const { load: loadDrafts } = useStoryCompose()
onMounted(() => {
  load()
  loadDrafts()
})
await Promise.all([useNews(), usePodcasts(), useFixtures()])

useSeoMeta({ title: 'Prototyp – Djurgår’n tills jag dör', robots: 'noindex, nofollow' })

const route = useRoute()
const links = useSectionLinks()
// Snacket and Stories bring their own side columns: the rail waits for a wider screen there.
const roomy = computed(() => links.value.shows('snacket') || links.value.shows('stories'))
// Lyssna already is the podcasts.
const episodes = computed(() => !links.value.shows('lyssna'))

/*
 * One vertical scrollbar: the page's. The rail is a sticky column, not a
 * scroll box of its own. While it fits the window it sticks by its top; when
 * it is taller (a short window) it sticks by its bottom instead (top = window
 * height − its height), so it scrolls along with the page until its last item
 * is in view, and nothing in it is ever out of reach.
 */
const rail = ref<HTMLElement>()
const railHeight = ref(0)
let railObserver: ResizeObserver | undefined
onMounted(() => {
  railObserver = new ResizeObserver(([entry]) => (railHeight.value = entry!.target.getBoundingClientRect().height))
  if (rail.value) railObserver.observe(rail.value)
})
onBeforeUnmount(() => railObserver?.disconnect())
const railTop = computed(() => `min(0px, calc(100dvh - ${railHeight.value}px))`)

// The prototype's own scrollbar colours (main.css), on desktop only; gone again when you leave it.
useHead({ htmlAttrs: { class: 'app-shell' } })
</script>

<template>
  <div class="relative min-h-dvh overflow-x-clip lg:grid lg:grid-cols-[var(--shell-nav-w)_minmax(0,1fr)]" :class="roomy ? '2xl:grid-cols-[var(--shell-nav-w)_minmax(0,1fr)_var(--shell-rail-w)]' : 'xl:grid-cols-[var(--shell-nav-w)_minmax(0,1fr)_var(--shell-rail-w)]'">
    <!-- Phones and tablets: the site as it is -->
    <div class="lg:hidden">
      <PilotBanner />
      <AppHeader />
      <p class="mx-4 mt-2 rounded-2xl bg-guld/10 px-4 py-2.5 text-xs leading-relaxed text-krita-dim sm:mx-6">
        <span class="font-bold text-guld">Prototyp för dator.</span> På mobilen gäller nuvarande design.
        <NuxtLink to="/" class="font-semibold text-krita underline underline-offset-2">Till startsidan</NuxtLink>
      </p>
    </div>

    <!-- Fits any ordinary window; scrolls on its own only when it can't (a short window with the player docked at its foot) -->
    <aside class="shell-scroll sticky top-0 hidden h-dvh overflow-y-auto border-r border-white/8 bg-natt/70 lg:block">
      <ShellNav />
    </aside>

    <main id="innehall" class="min-w-0">
      <NuxtPage :page-key="r => r.path" />
      <!-- On every screen: it says this is a supporter project, not the club's channel, and whose the content is -->
      <AppFooter />
    </main>

    <aside
      class="hidden border-l border-white/8 bg-natt/40"
      :class="roomy ? '2xl:block' : 'xl:block'"
      aria-label="På gång"
    >
      <div ref="rail" class="sticky" :style="{ top: railTop }">
        <ShellRail :episodes="episodes" />
      </div>
    </aside>

    <StoryComposeDialog />
    <MobileNav />
    <StripeBurst />
  </div>
</template>
