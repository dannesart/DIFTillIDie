<script setup lang="ts">
import type { Story } from '#shared/types/domain'

const props = defineProps<{ story: Story, lead?: boolean }>()

const { spotlight } = useStorySpotlight()
const { countForStory, filter } = useSnacket()

const selected = ref<string | null>(null)
const active = computed(() => props.story.sources.find(s => s.id === selected.value))
const talk = computed(() => countForStory(props.story.id))

const sportLabel = { fotboll: 'Fotboll', hockey: 'Hockey', klubben: 'Klubben' } as const
const sportDot = { fotboll: 'bg-himmel', hockey: 'bg-himmel-200', klubben: 'bg-guld' } as const

function toggle(id: string) {
  selected.value = selected.value === id ? null : id
}

function openTalk() {
  filter.value = { storyId: props.story.id }
  document.getElementById('snacket')?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <article
    :id="`story-${story.id}`"
    class="card group relative flex scroll-mt-28 flex-col overflow-hidden transition duration-500 hover:border-himmel/30"
    :class="[lead ? 'p-6 sm:p-9' : 'p-6', spotlight === story.id && 'animate-spotlight']"
  >
    <!-- Lead story gets a quiet stripe field behind the title -->
    <div v-if="lead" aria-hidden="true" class="stripes pointer-events-none absolute -right-10 -top-10 h-56 w-56 rotate-12 rounded-[2.5rem] opacity-[0.08] [--stripe:18px] transition duration-700 group-hover:rotate-6 group-hover:opacity-15" />

    <div class="relative flex items-center gap-2 text-krita-dim">
      <span class="size-2 rounded-full" :class="sportDot[story.sport]" />
      <span class="kicker">{{ sportLabel[story.sport] }} · {{ story.kicker }}</span>
      <span class="kicker ml-auto"><TimeAgo :at="story.updatedAt" /></span>
    </div>

    <h3 class="relative mt-4 font-display font-semibold leading-[1.02] tracking-tight" :class="lead ? 'text-4xl sm:text-6xl' : 'text-2xl'">
      {{ story.title }}
    </h3>
    <p class="relative mt-3 leading-relaxed text-krita-dim" :class="lead ? 'max-w-xl text-lg' : 'text-sm'">
      {{ story.about }}
    </p>

    <!-- Lead: every source's own headline, side by side -->
    <div v-if="lead" class="relative mt-8">
      <p class="kicker text-krita-dim">Så rubricerar källorna</p>
      <ul class="mt-3 divide-y divide-white/8 border-y border-white/8">
        <li v-for="src in story.sources" :key="src.id">
          <a :href="src.url" target="_blank" rel="noopener" class="group/src flex flex-col gap-1 py-4 sm:flex-row sm:items-start sm:gap-4 transition hover:bg-white/[0.03]">
            <span class="shrink-0 text-sm font-bold text-himmel sm:mt-1 sm:w-28">{{ src.outlet }}</span>
            <span class="min-w-0 flex-1">
              <span class="block font-display text-xl leading-snug group-hover/src:underline decoration-himmel/60 underline-offset-4">{{ src.headline }}</span>
              <span class="kicker mt-1.5 block text-krita-dim">{{ src.format }} · <TimeAgo :at="src.publishedAt" /> · demolänk ↗</span>
            </span>
          </a>
        </li>
      </ul>
    </div>

    <!-- Regular: source pills reveal each original headline -->
    <div v-else class="relative mt-5">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="src in story.sources"
          :key="src.id"
          class="chip"
          :class="selected === src.id ? 'border-himmel bg-himmel text-navy-950' : 'border-white/12 text-krita hover:border-himmel/60'"
          :aria-expanded="selected === src.id"
          @click="toggle(src.id)"
        >
          {{ src.outlet }}
          <span class="font-normal opacity-60">{{ src.format }}</span>
        </button>
      </div>
      <Transition enter-from-class="opacity-0 -translate-y-1" leave-to-class="opacity-0" enter-active-class="transition duration-300" leave-active-class="transition duration-150">
        <a v-if="active" :key="active.id" :href="active.url" target="_blank" rel="noopener" class="mt-3 block rounded-2xl border border-himmel/25 bg-navy-950/60 p-4 transition hover:border-himmel/60">
          <span class="kicker text-himmel">{{ active.outlet }} skriver</span>
          <span class="mt-1 block font-display text-lg leading-snug">{{ active.headline }}</span>
          <span class="kicker mt-2 block text-krita-dim"><TimeAgo :at="active.publishedAt" /> · Öppna källan (demolänk) ↗</span>
        </a>
      </Transition>
    </div>

    <div class="relative mt-auto flex items-center justify-between gap-3 pt-6 text-xs text-krita-dim">
      <span>{{ story.sources.length }} {{ story.sources.length === 1 ? 'källa' : 'källor' }}</span>
      <button v-if="talk" class="font-semibold text-krita transition hover:text-guld" @click="openTalk">
        Snackas om i {{ talk }} inlägg →
      </button>
    </div>
  </article>
</template>
