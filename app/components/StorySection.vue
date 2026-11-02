<script setup lang="ts">
const stories = useStories()
const { sport, matches } = useSport()

const visible = computed(() => stories.value.filter(s => matches(s.sport)))
const lead = computed(() => [...visible.value].sort((a, b) => b.sources.length - a.sources.length || b.updatedAt.localeCompare(a.updatedAt))[0])
const rest = computed(() => visible.value.filter(s => s.id !== lead.value?.id))

const heading = computed(() => ({ alla: 'Det som händer', fotboll: 'Det som händer på gräset', hockey: 'Det som händer på isen' })[sport.value])
</script>

<template>
  <section id="stories" class="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
    <div class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <p class="kicker text-himmel">Stories</p>
        <h2 class="section-title mt-3">{{ heading }}</h2>
      </div>
      <p class="max-w-sm text-sm leading-relaxed text-krita-dim">
        En Story samlar flera källor som bevakar samma sak. Varje källa behåller sin egen rubrik och länk –
        de säger inte nödvändigtvis samma sak.
      </p>
    </div>

    <TransitionGroup tag="div" move-class="transition duration-500" enter-from-class="opacity-0 scale-95" leave-to-class="opacity-0 scale-95" enter-active-class="transition duration-500" leave-active-class="transition duration-200 absolute" class="relative mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      <StoryCard v-if="lead" :key="lead.id" :story="lead" lead class="md:col-span-2 lg:row-span-2" />
      <StoryCard v-for="s in rest" :key="s.id" :story="s" />
    </TransitionGroup>
  </section>
</template>
