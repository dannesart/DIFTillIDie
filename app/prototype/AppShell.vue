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

    <aside class="sticky top-0 hidden h-dvh overflow-y-auto border-r border-white/8 bg-natt/70 lg:block">
      <ShellNav />
    </aside>

    <main id="innehall" class="min-w-0">
      <NuxtPage :page-key="r => r.path" />
    </main>

    <aside
      class="sticky top-0 hidden h-dvh overflow-y-auto border-l border-white/8 bg-natt/40"
      :class="roomy ? '2xl:block' : 'xl:block'"
      aria-label="På gång"
    >
      <ShellRail :episodes="episodes" />
    </aside>

    <div class="lg:hidden">
      <AppFooter />
    </div>
    <StoryComposeDialog />
    <MobileNav />
    <StripeBurst />
  </div>
</template>
