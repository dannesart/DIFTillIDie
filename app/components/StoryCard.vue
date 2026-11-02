<script setup lang="ts">
import type { Story } from '#shared/types/domain'

const props = defineProps<{ story: Story, lead?: boolean }>()

const { spotlight } = useStorySpotlight()
const { countForStory, filter } = useSnacket()

const leadSource = computed(() => leadOf(props.story))
const others = computed(() => props.story.sources.filter(s => s.id !== props.story.leadId))
const talk = computed(() => countForStory(props.story.id))
const outlets = computed(() => [...new Set(props.story.sources.map(s => s.outlet))])

const sportLabel = { fotboll: 'Fotboll', hockey: 'Hockey' } as const
const sportDot = { fotboll: 'bg-himmel', hockey: 'bg-himmel-200' } as const

function openTalk() {
  filter.value = { storyId: props.story.id }
  document.getElementById('snacket')?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <article
    :id="story.id"
    class="card group relative flex scroll-mt-28 flex-col overflow-hidden transition duration-500 hover:border-himmel/30"
    :class="[lead ? 'p-6 sm:p-9' : 'p-6', spotlight === story.id && 'animate-spotlight']"
  >
    <!-- Lead story gets a quiet stripe field behind the title -->
    <div v-if="lead" aria-hidden="true" class="stripes pointer-events-none absolute -right-10 -top-10 h-56 w-56 rotate-12 rounded-[2.5rem] opacity-[0.08] [--stripe:18px] transition duration-700 group-hover:rotate-6 group-hover:opacity-15" />

    <div class="relative flex items-center gap-2 text-krita-dim">
      <span class="size-2 shrink-0 rounded-full" :class="sportDot[story.sport]" />
      <span class="kicker truncate">{{ sportLabel[story.sport] }} · {{ leadSource.outlet }}</span>
      <span class="kicker ml-auto shrink-0"><TimeAgo :at="leadSource.publishedAt" /></span>
    </div>

    <!-- The headline is always the lead source's own, linking to its article -->
    <h3 class="relative mt-4 font-display font-semibold leading-[1.05] tracking-tight" :class="lead ? 'text-3xl sm:text-5xl' : 'text-xl sm:text-2xl'">
      <a :href="leadSource.url" target="_blank" rel="noopener" class="decoration-himmel/60 decoration-2 underline-offset-[6px] hover:underline">
        {{ leadSource.headline }}
      </a>
    </h3>
    <p v-if="leadSource.excerpt" class="relative mt-3 leading-relaxed text-krita-dim" :class="lead ? 'max-w-xl text-lg' : 'line-clamp-3 text-sm'">
      {{ leadSource.excerpt }}
    </p>

    <!-- Other sources on the same event, each with its own headline -->
    <div v-if="others.length" class="relative mt-6">
      <p class="kicker text-krita-dim">Fler källor om samma händelse</p>
      <ul class="mt-2 divide-y divide-white/8 border-y border-white/8">
        <li v-for="src in (lead ? others : others.slice(0, 2))" :key="src.id">
          <a :href="src.url" target="_blank" rel="noopener" class="group/src flex flex-col gap-1 py-3 transition hover:bg-white/[0.03] sm:flex-row sm:items-baseline sm:gap-4">
            <span class="shrink-0 text-sm font-bold text-himmel sm:w-28">{{ src.outlet }}</span>
            <span class="min-w-0 flex-1">
              <span class="block font-display leading-snug decoration-himmel/60 underline-offset-4 group-hover/src:underline" :class="lead ? 'text-xl' : 'text-base'">{{ src.headline }}</span>
              <span class="kicker mt-1 block text-krita-dim"><TimeAgo :at="src.publishedAt" /> · läs hos {{ src.outlet }} ↗</span>
            </span>
          </a>
        </li>
      </ul>
      <p v-if="!lead && others.length > 2" class="mt-2 text-xs text-krita-dim">+ {{ others.length - 2 }} till</p>
      <p v-if="story.sharedNames.length" class="mt-3 text-xs leading-relaxed text-krita-dim">
        Samlade automatiskt: källorna nämner <span class="text-krita">{{ story.sharedNames.join(', ') }}</span> inom samma dygn.
      </p>
    </div>

    <!-- Source pills: straight to each original article -->
    <div class="relative mt-auto flex flex-wrap items-center gap-2 pt-6">
      <a
        v-for="src in story.sources"
        :key="src.id"
        :href="src.url"
        target="_blank"
        rel="noopener"
        class="chip border-white/12 text-krita hover:border-himmel hover:bg-himmel hover:text-navy-950"
        :title="`${src.publisher}: ${src.headline}`"
      >
        {{ src.outlet }}
        <span v-if="story.sources.length > 1" class="font-normal opacity-60"><TimeAgo :at="src.publishedAt" /></span>
        <span aria-hidden="true">↗</span>
      </a>
      <span class="ml-auto text-xs text-krita-dim">
        <button v-if="talk" class="font-semibold text-krita transition hover:text-guld" @click="openTalk">Snackas om i {{ talk }} inlägg →</button>
        <template v-else>{{ story.sources.length }} {{ story.sources.length === 1 ? 'källa' : `källor · ${outlets.length === 1 ? outlets[0] : `${outlets.length} redaktioner`}` }}</template>
      </span>
    </div>
  </article>
</template>
