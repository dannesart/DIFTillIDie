<script setup lang="ts">
import type { FeedPost } from '~/composables/useSnacket'

/* One post in Snacket på stan, with its real reactions and comments. */
const props = defineProps<{ post: FeedPost }>()
const emit = defineEmits<{ mention: [handle: string] }>()

const { filter, community } = useSnacket()
const { show } = useStorySpotlight()
const { stories } = useNews()

const story = computed(() => stories.value.find(s => storyAnswersTo(s, props.post.storyId)))
const tokens = computed(() => tokenize(props.post.body))

// Deleting a post is for everyone, so it asks first and waits for Supabase.
const confirming = ref(false)
const removing = ref(false)
const removeError = ref<string | null>(null)
async function remove() {
  removing.value = true
  removeError.value = null
  const r = await community.remove(props.post.id)
  removing.value = false
  if (!r.ok) removeError.value = r.message
}
</script>

<template>
  <article class="card p-5 transition duration-300 hover:border-white/15" :class="post.own && 'border-himmel/30'">
    <header class="flex items-start gap-3">
      <Avatar :name="post.author.name" />
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-baseline gap-x-2">
          <span class="font-semibold">{{ post.author.name }}</span>
          <button class="text-sm text-krita-dim hover:text-himmel" :title="`Nämn @${post.author.handle}`" @click="emit('mention', post.author.handle)">@{{ post.author.handle }}</button>
        </p>
        <p class="text-xs text-krita-dim">
          <TimeAgo :at="post.createdAt" />
          <span v-if="post.sport" class="capitalize"> · {{ post.sport }}</span>
        </p>
      </div>
      <template v-if="post.own">
        <div v-if="confirming" class="flex shrink-0 items-center gap-2 text-xs">
          <button class="font-bold text-rod hover:underline disabled:opacity-50" :disabled="removing" @click="remove">{{ removing ? 'Tar bort…' : 'Ja, ta bort för alla' }}</button>
          <button class="text-krita-dim hover:text-krita" :disabled="removing" @click="confirming = false; removeError = null">Avbryt</button>
        </div>
        <button v-else class="text-xs text-krita-dim hover:text-rod" @click="confirming = true">Ta bort</button>
      </template>
    </header>
    <p v-if="removeError" class="mt-2 text-right text-xs font-semibold text-rod" role="alert">{{ removeError }}</p>

    <p class="mt-3 whitespace-pre-line text-[1.02rem] leading-relaxed">
      <template v-for="(t, i) in tokens" :key="i">
        <button v-if="t.type === 'mention'" class="font-semibold text-himmel hover:underline" :title="`Svara @${t.value}`" @click="emit('mention', t.value)">@{{ t.value }}</button>
        <button v-else-if="t.type === 'tag'" class="font-semibold text-guld hover:underline" @click="filter = { tag: t.value.toLowerCase() }">#{{ t.value }}</button>
        <template v-else>{{ t.value }}</template>
      </template>
    </p>

    <button v-if="story" class="group mt-4 flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-navy-950/60 p-3 text-left transition hover:border-himmel/50" @click="show(story.id)">
      <span class="h-10 w-1.5 shrink-0 rounded-full" style="background: repeating-linear-gradient(180deg, var(--color-himmel) 0 5px, var(--color-navy-700) 5px 10px)" />
      <span class="min-w-0 flex-1">
        <span class="kicker block text-krita-dim">Story · {{ story.sources.length }} källor</span>
        <span class="block truncate font-display text-base font-semibold">{{ leadOf(story).headline }}</span>
      </span>
      <span class="text-krita-dim transition group-hover:translate-x-1 group-hover:text-himmel">→</span>
    </button>

    <RealPostInteractions :post-id="post.id" />
  </article>
</template>
