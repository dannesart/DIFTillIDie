<script setup lang="ts">
const { news, stories, status } = useNews()
const { sport, matches } = useSport()

// Lead (2×2) + 5 cards fills the desktop grid without an orphan.
const INITIAL = 6
const expanded = ref(false)

const visible = computed(() => stories.value.filter(s => matches(s.sport)))

// Lead: the most independently covered Story among the freshest news.
const lead = computed(() => {
  const list = visible.value
  if (!list.length) return undefined
  const newest = Date.parse(list[0]!.updatedAt)
  const fresh = list.filter(s => newest - Date.parse(s.updatedAt) < 36 * 3_600_000)
  // Original reporting counts first: compilations of others' reporting are not extra coverage.
  return [...fresh].sort((a, b) => reportingCounts(b).original - reportingCounts(a).original || b.sources.length - a.sources.length || b.updatedAt.localeCompare(a.updatedAt))[0]
})
const rest = computed(() => visible.value.filter(s => s.id !== lead.value?.id))
const shown = computed(() => (expanded.value ? rest.value : rest.value.slice(0, INITIAL - 1)))
watch(sport, () => (expanded.value = false))

const heading = computed(() => ({ alla: 'Det som händer', fotboll: 'Det som händer på gräset', hockey: 'Det som händer på isen' })[sport.value])
// "No news" and "can't reach the sources" are different things; say which.
const sourcesDown = computed(() => {
  const relevant = news.value.sources.filter(s => matches(s.sport))
  return relevant.length > 0 && relevant.every(s => !s.ok && !s.stale)
})
</script>

<template>
  <section id="stories" class="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
    <div class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <p class="kicker flex items-center gap-2 text-himmel">
          Stories
          <span class="rounded-full bg-himmel/15 px-2 py-0.5 text-himmel">Riktiga nyheter</span>
        </p>
        <h2 class="section-title mt-3">{{ heading }}</h2>
      </div>
      <p class="max-w-sm text-sm leading-relaxed text-krita-dim">
        Hämtat från källornas egna flöden. När flera artiklar bevakar samma händelse samlas de i en Story –
        varje källa behåller sin rubrik och länk. Rubrikerna är källornas egna, aldrig våra.
      </p>
    </div>

    <SourceStatus :sources="news.sources" :generated-at="news.generatedAt" class="mt-6" />

    <div v-if="status === 'pending' && !stories.length" class="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      <div v-for="i in 3" :key="i" class="card h-56 animate-pulse" />
    </div>

    <div v-else-if="!visible.length" class="card mt-10 p-8 text-center sm:p-12">
      <p class="font-display text-2xl font-semibold">
        <template v-if="sourcesDown || status === 'error'">Vi når inte {{ sport === 'hockey' ? 'hockeykällan' : 'nyhetskällorna' }} just nu.</template>
        <template v-else-if="sport === 'hockey'">Inga hockeynyheter om Djurgården i källorna just nu.</template>
        <template v-else>Inga nyheter om Djurgården i källorna just nu.</template>
      </p>
      <p class="mt-2 text-sm text-krita-dim">Vi visar hellre ingenting än något påhittat. Försök igen om en stund.</p>
    </div>

    <template v-else>
      <TransitionGroup tag="div" move-class="transition duration-500" enter-from-class="opacity-0 scale-95" leave-to-class="opacity-0 scale-95" enter-active-class="transition duration-500" leave-active-class="transition duration-200 absolute" class="relative mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <StoryCard v-if="lead" :key="lead.id" :story="lead" lead class="md:col-span-2 lg:row-span-2" />
        <StoryCard v-for="s in shown" :key="s.id" :story="s" />
      </TransitionGroup>

      <div v-if="rest.length > INITIAL - 1" class="mt-8 text-center">
        <button class="rounded-full border border-white/15 px-5 py-3 text-sm font-bold transition hover:-translate-y-0.5 hover:border-himmel hover:text-himmel" @click="expanded = !expanded">
          {{ expanded ? 'Visa färre' : `Visa alla ${visible.length} stories` }}
        </button>
      </div>
    </template>
  </section>
</template>
