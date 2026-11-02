<script setup lang="ts">
import type { Story } from '#shared/types/domain'

/*
 * The conversation drawer inside a Story card: what's been said about this
 * Story (in this browser), and the composer with the Story already attached.
 * Posts land in Snacket på stan too — one set of posts, two ways in.
 */
const props = defineProps<{ story: Story }>()

const { postsForStory, filter } = useSnacket()
const posts = computed(() => postsForStory(props.story))
const SHOWN = 3
const fresh = ref<string | null>(null)
let freshTimer: ReturnType<typeof setTimeout> | undefined

function onPublished(id: string) {
  fresh.value = id
  clearTimeout(freshTimer)
  freshTimer = setTimeout(() => (fresh.value = null), 2600)
}
onBeforeUnmount(() => clearTimeout(freshTimer))

function openInSnacket() {
  filter.value = { storyId: props.story.id }
  document.getElementById('snacket')?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <div class="relative mt-5 border-t border-white/8 pt-5">
    <div class="flex items-baseline justify-between gap-3">
      <p class="kicker text-guld">Snacket om det här</p>
      <button v-if="posts.length" class="text-xs font-semibold text-krita-dim transition hover:text-guld" @click="openInSnacket">
        {{ posts.length > SHOWN ? `Alla ${posts.length}` : 'Öppna' }} i Snacket på stan →
      </button>
    </div>

    <TransitionGroup
      tag="ul"
      class="mt-3 space-y-2"
      enter-from-class="opacity-0 motion-safe:-translate-y-2"
      enter-active-class="transition duration-500 ease-out-expo"
    >
      <li
        v-for="p in posts.slice(0, SHOWN)"
        :key="p.id"
        class="flex gap-2.5 rounded-2xl px-3 py-2.5 transition-colors duration-700"
        :class="fresh === p.id ? 'bg-himmel/10 ring-1 ring-guld/70' : 'bg-white/[0.04]'"
      >
        <Avatar :name="p.author.name" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="text-xs"><span class="font-semibold">{{ p.author.name }}</span> <span class="text-krita-dim">· <TimeAgo :at="p.createdAt" /></span></p>
          <p class="mt-0.5 line-clamp-3 text-sm leading-relaxed">{{ p.body }}</p>
        </div>
      </li>
    </TransitionGroup>

    <p v-if="!posts.length" class="mt-2 text-sm leading-relaxed text-krita-dim">
      Ingen har snackat om det här än – i alla fall inte här. Bli först att säga något.
    </p>

    <PostComposer :story="story" autofocus class="mt-3" @published="onPublished" />

    <p class="mt-2 text-[0.7rem] leading-relaxed text-krita-dim">
      Hamnar även i Snacket på stan. Ingen annan kan se det än.
    </p>
  </div>
</template>
