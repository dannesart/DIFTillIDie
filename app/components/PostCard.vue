<script setup lang="ts">
import type { FeedPost } from '~/composables/useSnacket'
import { frozenLead } from '~/lib/posts'

/*
 * One post in Snacket på stan, with its real reactions and comments.
 * The author's name and avatar lead to their page (by user id); their
 * @handle inserts a mention, where there is a composer to insert it into.
 * On a supporter's own wall: `onWall` (no link to the page you're on, and
 * no mention buttons, since there's no composer there).
 */
const props = defineProps<{ post: FeedPost, onWall?: boolean }>()
const emit = defineEmits<{ mention: [handle: string], removed: [id: string] }>()

const { filter, community } = useSnacket()
const { show } = useStorySpotlight()
const route = useRoute()
const authorPath = computed(() => supporterPath(props.post.author.handle))

// Tags and Stories live on the front page: from elsewhere, go there first.
async function showTag(tag: string) {
  filter.value = { tag: tag.toLowerCase() }
  if (route.path !== '/') await navigateTo('/#snacket')
}
async function showStory(id: string) {
  if (route.path !== '/') await navigateTo(`/#${id}`)
  show(id)
}
const { stories, status: newsStatus } = useNews()

/*
 * The Story a post is about:
 *  - frozen: kept with the post when it was published (exactly the sources
 *    attached then, as read from the feeds), shown for good;
 *  - live: a post from before frozen Stories, while its Story is in the feeds;
 *  - gone: such a post after that. Said plainly; nothing is guessed.
 */
const live = computed(() => findStory(stories.value, props.post.storyId))
const frozen = computed(() => props.post.storyRef)
const lead = computed(() => frozen.value && frozenLead(frozen.value))
const gone = computed(() => !!props.post.storyId && !frozen.value && !live.value && newsStatus.value !== 'pending' && newsStatus.value !== 'idle')
const sourcesLabel = (n: number) => `${n} ${n === 1 ? 'källa' : 'källor'}`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
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
  else emit('removed', props.post.id)
}
</script>

<template>
  <article class="card p-5 transition duration-300 hover:border-white/15" :class="post.own && 'border-himmel/30'">
    <header class="flex items-start gap-3">
      <Avatar v-if="onWall" :name="post.author.name" :design="post.author.avatar" />
      <NuxtLink v-else :to="authorPath" class="shrink-0 rounded-full transition hover:scale-105" :aria-label="`${post.author.name} på läktaren`" tabindex="-1">
        <Avatar :name="post.author.name" :design="post.author.avatar" />
      </NuxtLink>
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-baseline gap-x-2">
          <span v-if="onWall" class="font-semibold">{{ post.author.name }}</span>
          <NuxtLink v-else :to="authorPath" class="font-semibold underline-offset-2 hover:text-himmel hover:underline" :title="`${post.author.name} på läktaren`">{{ post.author.name }}</NuxtLink>
          <span v-if="onWall" class="text-sm text-krita-dim">@{{ post.author.handle }}</span>
          <button v-else class="text-sm text-krita-dim hover:text-himmel" :title="`Nämn @${post.author.handle}`" @click="emit('mention', post.author.handle)">@{{ post.author.handle }}</button>
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
        <span v-if="t.type === 'mention' && onWall" class="font-semibold text-himmel">@{{ t.value }}</span>
        <button v-else-if="t.type === 'mention'" class="font-semibold text-himmel hover:underline" :title="`Svara @${t.value}`" @click="emit('mention', t.value)">@{{ t.value }}</button>
        <button v-else-if="t.type === 'tag'" class="font-semibold text-guld hover:underline" @click="showTag(t.value)">#{{ t.value }}</button>
        <template v-else>{{ t.value }}</template>
      </template>
    </p>

    <!-- Frozen at publication: the outlets' own headlines and links, as they stood in their feeds -->
    <div v-if="frozen && lead" class="mt-4 rounded-2xl border border-white/10 bg-navy-950/60 p-3">
      <component
        :is="live ? 'button' : 'div'"
        class="group flex w-full items-center gap-3 text-left"
        v-bind="live ? { type: 'button', title: 'Visa Storyn' } : {}"
        @click="live && showStory(live.id)"
      >
        <span class="h-10 w-1.5 shrink-0 rounded-full" style="background: repeating-linear-gradient(180deg, var(--color-himmel) 0 5px, var(--color-navy-700) 5px 10px)" />
        <span class="min-w-0 flex-1">
          <span class="kicker block text-krita-dim">Story · {{ sourcesLabel(frozen.sources.length) }}</span>
          <span class="block truncate font-display text-base font-semibold">{{ lead.headline }}</span>
        </span>
        <span v-if="live" class="text-krita-dim transition group-hover:translate-x-1 group-hover:text-himmel">→</span>
      </component>
      <p class="mt-2 text-xs text-krita-dim">
        Ur flödet från {{ lead.outlet }}<template v-if="lead.publisher && lead.publisher !== lead.outlet"> ({{ lead.publisher }})</template><template v-if="lead.capturedAt">, {{ day(lead.capturedAt) }}</template>.
        <a :href="lead.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-krita underline-offset-2 hover:text-himmel hover:underline">Läs hos {{ lead.outlet }} ↗</a>
      </p>
      <details v-if="frozen.sources.length > 1" class="mt-1 text-xs text-krita-dim">
        <summary class="cursor-pointer hover:text-krita">Alla {{ sourcesLabel(frozen.sources.length) }}</summary>
        <ul class="mt-1.5 space-y-1.5">
          <li v-for="s in frozen.sources" :key="s.key">
            <a :href="s.url" target="_blank" rel="noopener noreferrer" class="hover:text-himmel"><span class="font-semibold text-krita">{{ s.outlet }}:</span> {{ s.headline }} ↗</a>
          </li>
        </ul>
      </details>
    </div>

    <!-- From before frozen Stories, while its Story is still in the feeds -->
    <button v-else-if="live" class="group mt-4 flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-navy-950/60 p-3 text-left transition hover:border-himmel/50" @click="showStory(live.id)">
      <span class="h-10 w-1.5 shrink-0 rounded-full" style="background: repeating-linear-gradient(180deg, var(--color-himmel) 0 5px, var(--color-navy-700) 5px 10px)" />
      <span class="min-w-0 flex-1">
        <span class="kicker block text-krita-dim">Story · {{ sourcesLabel(live.sources.length) }}</span>
        <span class="block truncate font-display text-base font-semibold">{{ leadOf(live).headline }}</span>
      </span>
      <span class="text-krita-dim transition group-hover:translate-x-1 group-hover:text-himmel">→</span>
    </button>

    <!-- …and after it has left them: we never kept a copy, so we don't guess -->
    <p v-else-if="gone" class="mt-4 rounded-2xl border border-dashed border-white/12 px-3 py-2.5 text-xs text-krita-dim">
      Inlägget handlade om en Story som inte längre finns i nyhetsflödena. Den sparades inte när inlägget skrevs.
    </p>

    <RealPostInteractions :post-id="post.id" />
  </article>
</template>
