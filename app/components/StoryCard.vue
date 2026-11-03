<script setup lang="ts">
import type { Story } from '#shared/types/domain'

const props = defineProps<{ story: Story, lead?: boolean }>()

const { spotlight } = useStorySpotlight()
const { countForStory, filter } = useSnacket()
const compose = useStoryCompose()

const leadSource = computed(() => leadOf(props.story))
const others = computed(() => props.story.sources.filter(s => s.id !== props.story.leadId))
const talk = computed(() => countForStory(props.story))
// Compiled articles summarise others' reporting: never count them as extra confirmation.
const counts = computed(() => reportingCounts(props.story))
const sourceSummary = computed(() => {
  const { original, compiled, originalOutlets } = counts.value
  const parts: string[] = []
  if (original) parts.push(original === 1 ? `1 egen rapport (${originalOutlets[0]})` : `${original} egna rapporter · ${originalOutlets.join(', ')}`)
  if (compiled) parts.push(compiled === 1 ? '1 sammanställning' : `${compiled} sammanställningar`)
  return parts.join(' · ')
})

const sportLabel = { fotboll: 'Fotboll', hockey: 'Hockey' } as const
const sportDot = { fotboll: 'bg-himmel', hockey: 'bg-himmel-200' } as const

// Writing and reading are two intents: the button writes (in a dialog),
// the count reads (in Snacket på stan). Neither changes this card's size.
const hasDraft = computed(() => !!compose.draftFor(props.story.id))
function readTalk() {
  filter.value = { storyId: props.story.id }
  document.getElementById('snacket')?.scrollIntoView({ behavior: 'smooth' })
}

// A little pop when a new post about this Story arrives.
const popped = ref(false)
watch(talk, (n, old) => {
  if (n > old) {
    popped.value = false
    requestAnimationFrame(() => (popped.value = true))
  }
})
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
      <span class="kicker truncate">{{ sportLabel[story.sport] }} · {{ leadSource.outlet }}<template v-if="leadSource.reporting === 'compiled'"> · sammanställning</template></span>
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
              <span class="kicker mt-1 block text-krita-dim"><TimeAgo :at="src.publishedAt" /><template v-if="src.reporting === 'compiled'"> · sammanställer andra medier</template> · läs hos {{ src.outlet }} ↗</span>
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
        :title="`${src.publisher}${src.reporting === 'compiled' ? ' (sammanställer andra medier)' : ''}: ${src.headline}`"
      >
        {{ src.outlet }}
        <span v-if="story.sources.length > 1" class="font-normal opacity-60"><TimeAgo :at="src.publishedAt" /></span>
        <span aria-hidden="true">↗</span>
      </a>
      <span class="ml-auto text-xs text-krita-dim">{{ story.sources.length === 1 ? '1 källa' : sourceSummary }}</span>
    </div>

    <!-- Every Story invites a conversation -->
    <div class="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        class="talk-button inline-flex items-center gap-2 rounded-full border border-guld/40 px-4 py-2 text-sm font-bold text-guld transition duration-300 hover:border-guld hover:bg-guld/10"
        aria-haspopup="dialog"
        @click="compose.open(story.id)"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 5h16v11H9l-5 4z" />
          <circle class="dot" cx="9" cy="10.5" r="1" fill="currentColor" stroke="none" />
          <circle class="dot" cx="12" cy="10.5" r="1" fill="currentColor" stroke="none" />
          <circle class="dot" cx="15" cy="10.5" r="1" fill="currentColor" stroke="none" />
        </svg>
        {{ hasDraft ? 'Fortsätt ditt utkast' : 'Snacka om detta' }}
      </button>
      <button
        v-if="talk"
        class="inline-flex items-center gap-1.5 text-sm font-semibold text-krita-dim transition hover:text-krita"
        title="Läs i Snacket på stan"
        @click="readTalk"
      >
        <span aria-hidden="true">💬</span>
        <span class="inline-block tabular-nums" :class="popped && 'animate-pop'" @animationend="popped = false">{{ talk }}</span>
        inlägg
        <span aria-hidden="true">→</span>
      </button>
    </div>
  </article>
</template>

<style scoped>
/* The three dots "type" while you hover, as if someone's about to speak. */
.dot { transform-box: fill-box; }
@media (prefers-reduced-motion: no-preference) {
  .talk-button:hover .dot { animation: typing 1s ease-in-out infinite; }
  .talk-button:hover .dot:nth-child(3) { animation-delay: 0.15s; }
  .talk-button:hover .dot:nth-child(4) { animation-delay: 0.3s; }
}
@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-1.5px); }
}
</style>
