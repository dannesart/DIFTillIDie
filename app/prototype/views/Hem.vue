<script setup lang="ts">
/*
 * Prototype home: a small hero, then what supporters are doing right now
 * (the newest real Snacket posts) and the Stories everyone is reading. Each
 * part leads to its own view instead of continuing down the page.
 */
const links = useSectionLinks()
const { all, community } = useSnacket()
const { status: feedStatus } = community
const { stories, status: newsStatus } = useNews()
const { matches } = useSport()

const demoNow = useDemoNow()
const now = useNow(60_000)
const greeting = computed(() => ({
  morgon: 'God morgon, Djurgårdare',
  dag: 'Hej, Djurgårdare',
  kvall: 'God kväll, Djurgårdare',
  natt: 'Sent ute, Djurgårdare?',
})[dayPart(now.value ?? demoNow.value)])

const POSTS = 4
const latest = computed(() => all.value.filter(p => matches(p.sport)).slice(0, POSTS))
const loading = computed(() => feedStatus.value === 'idle' || feedStatus.value === 'loading')
const topStories = computed(() => stories.value.filter(s => matches(s.sport)).slice(0, 3))

/*
 * Three desktop placements of the feed, kept side by side for comparison
 * (?hem=centrerad | vanster, default mitt). Below lg they are identical.
 * - centrerad: the first version, 56rem centred in the main column.
 * - vanster: 56rem anchored to the sidebar, with Stories' gutter.
 * - mitt: 60rem, with the column's spare room split 1 : 2 between the
 *   sidebar side and the rail side, so it sits between the two.
 */
const route = useRoute()
const LAYOUTS = {
  centrerad: { outer: 'lg:px-10', inner: '' },
  vanster: { outer: 'lg:mx-0', inner: '' },
  mitt: { outer: 'lg:max-w-none lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,60rem)_minmax(0,2fr)]', inner: 'lg:col-start-2' },
}
const layout = computed(() => LAYOUTS[route.query.hem as keyof typeof LAYOUTS] ?? LAYOUTS.mitt)
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 pb-24 sm:px-6 lg:pt-8" :class="layout.outer">
    <div :class="layout.inner">
      <!-- A smaller hero: who we are, in one band -->
      <section class="relative isolate mt-4 overflow-hidden rounded-[2rem] border border-white/8 bg-navy-900/60 px-6 py-7 sm:px-8 lg:mt-0">
        <div aria-hidden="true" class="grain absolute -right-10 -top-8 -z-10 h-56 w-56 rotate-[8deg] overflow-hidden rounded-[2rem] opacity-70">
          <div class="stripes absolute inset-0 [--stripe:22px]" />
          <div class="absolute inset-0 bg-gradient-to-l from-transparent via-navy-900/40 to-navy-900" />
        </div>
        <p class="kicker flex items-center gap-2 text-himmel">
          <span class="inline-block size-1.5 rounded-full bg-guld" />
          {{ greeting }}
        </p>
        <h1 class="mt-3 font-display font-black leading-[0.9] tracking-[-0.03em]">
          <span class="stripe-text text-5xl sm:text-6xl">Djurgår’n</span>
          <span class="mt-1 block text-3xl font-semibold italic text-krita sm:ml-2 sm:mt-0 sm:inline sm:text-4xl">tills jag dör<span class="text-rod">.</span></span>
        </h1>
        <p class="mt-3 max-w-md text-sm leading-relaxed text-krita-dim">
          Fotboll och hockey, snack från läktaren och poddar för långa kvällar.
        </p>
      </section>

      <!-- On a laptop the rail isn't shown: the next match comes here instead -->
      <MatchCard class="mt-6 xl:hidden" />

      <section class="mt-10" aria-labelledby="hem-snacket">
        <div class="flex items-end justify-between gap-4">
          <div>
            <p class="kicker text-guld">Community</p>
            <h2 id="hem-snacket" class="mt-1 font-display text-3xl font-bold">Senaste på läktaren</h2>
          </div>
          <NuxtLink :to="links.section('snacket')" class="shrink-0 rounded-full border border-white/15 px-4 py-2 text-sm font-bold transition hover:border-himmel hover:text-himmel">Hela Snacket →</NuxtLink>
        </div>

        <ul v-if="loading" class="mt-5 space-y-4" aria-label="Hämtar inlägg">
          <li v-for="n in 2" :key="n" class="card h-32 animate-pulse bg-white/[0.03]" />
        </ul>
        <p v-else-if="feedStatus === 'unavailable'" class="card mt-5 p-5 text-sm text-krita-dim">Snacket är inte påslaget här.</p>
        <p v-else-if="feedStatus === 'error'" class="card mt-5 p-5 text-sm" role="alert">Kunde inte hämta snacket just nu.</p>
        <ul v-else-if="latest.length" class="mt-5 space-y-4">
          <li v-for="post in latest" :key="post.id">
            <PostCard :post="post" no-mentions />
          </li>
        </ul>
        <div v-else class="card mt-5 p-6 text-center">
          <p class="font-display text-xl font-bold">Läktaren väntar på första ramsan 💙</p>
          <NuxtLink :to="links.section('snacket')" class="mt-2 inline-block text-sm font-semibold text-himmel hover:underline">Skriv i Snacket</NuxtLink>
        </div>
      </section>

      <section class="mt-14" aria-labelledby="hem-stories">
        <div class="flex items-end justify-between gap-4">
          <div>
            <p class="kicker text-himmel">Stories · riktiga nyheter</p>
            <h2 id="hem-stories" class="mt-1 font-display text-3xl font-bold">Det som händer</h2>
          </div>
          <NuxtLink :to="links.section('stories')" class="shrink-0 rounded-full border border-white/15 px-4 py-2 text-sm font-bold transition hover:border-himmel hover:text-himmel">Alla stories →</NuxtLink>
        </div>
        <div v-if="newsStatus === 'pending' && !stories.length" class="mt-5 grid gap-5 md:grid-cols-2" aria-busy="true">
          <div v-for="i in 2" :key="i" class="card h-56 animate-pulse" />
        </div>
        <p v-else-if="!topStories.length" class="card mt-5 p-6 text-center text-sm text-krita-dim">Inga nyheter om Djurgården i källorna just nu.</p>
        <div v-else class="mt-5 grid gap-5 md:grid-cols-2">
          <StoryCard v-for="(s, i) in topStories" :key="s.id" :story="s" :lead="i === 0" :class="i === 0 && 'md:col-span-2'" />
        </div>
      </section>
    </div>
  </div>
</template>
