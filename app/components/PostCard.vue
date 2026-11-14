<script setup lang="ts">
import type { FeedPost } from '~/composables/useSnacket'
import { frozenLead } from '~/lib/posts'

/*
 * One post in Snacket på stan, with its real reactions and comments.
 * The author's name and avatar lead to their page (by user id); their
 * @handle in the header starts a reply (the composer with the mention
 * ready), where there is a composer. @mentions in the text lead to the
 * supporter mentioned, when they're a supporter you may see (MentionLink).
 * On a supporter's own wall: `onWall` (no link to the page you're on, and
 * no reply button, since there's no composer there).
 * `noMentions` alone: links, but no reply button (a preview without a composer).
 */
const props = defineProps<{ post: FeedPost, onWall?: boolean, noMentions?: boolean }>()
const emit = defineEmits<{ mention: [handle: string], removed: [id: string] }>()

const { filter, community } = useSnacket()
const { show } = useStorySpotlight()
const links = useSectionLinks()
const authorPath = computed(() => links.value.supporter(props.post.author.handle))

// Tags and Stories live on their own pages: from elsewhere, go there first.
async function showTag(tag: string) {
  filter.value = { tag: tag.toLowerCase() }
  if (!links.value.shows('snacket')) await navigateTo(links.value.section('snacket'))
}
async function showStory(id: string) {
  if (!links.value.shows('stories')) await navigateTo(links.value.story(id))
  show(id)
}
const { stories, status: newsStatus } = useNews()

/*
 * The Story a post is about:
 *  - frozen: kept with the post when it was published (exactly the sources
 *    attached then, as read from the feeds), shown for good;
 *  - live: the Story in the feeds now (storyOfPost: for a frozen Story, the one
 *    holding its lead article; never another event's by the old id), linked
 *    while there is one;
 *  - unlinked: a frozen Story with no live one, or one that couldn't be read;
 *  - gone: a post from before frozen Stories once its Story left the feeds.
 * Said plainly once the news has loaded; nothing is guessed.
 */
const live = computed(() => storyOfPost(stories.value, props.post))
const frozen = computed(() => props.post.storyRef)
const lead = computed(() => frozen.value && frozenLead(frozen.value))
const newsLoaded = computed(() => newsStatus.value !== 'pending' && newsStatus.value !== 'idle')
const unlinked = computed(() => newsLoaded.value && !live.value && (!!frozen.value || !!props.post.storyRefInvalid))
const gone = computed(() => newsLoaded.value && !!props.post.storyId && !frozen.value && !props.post.storyRefInvalid && !live.value)
const NO_LIVE_STORY = 'Ingen aktuell Story kan kopplas säkert till det här inlägget.'
const sourcesLabel = (n: number) => `${n} ${n === 1 ? 'källa' : 'källor'}`
// Only a real web address is a link; anything else is shown as text, and we say the link isn't there.
const linkable = (url: string | undefined) => !!url && /^https?:\/\//i.test(url)
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
  <article class="card p-5">
    <!-- Wraps: on a narrow screen or with larger text, "Ta bort" (or "Ja, ta bort för alla") goes to its own line
         instead of out of the card, or of squeezing the name to a word per line. The author (avatar and name) stays
         together and wants 12rem, so it grows with the text (Issue #16). -->
    <header class="flex flex-wrap items-start gap-3">
      <div class="flex min-w-0 flex-[1_1_12rem] items-start gap-3">
        <Avatar v-if="onWall" :name="post.author.name" :design="post.author.avatar" />
        <NuxtLink v-else :to="authorPath" class="shrink-0 rounded-full transition hover:scale-105" :aria-label="`${post.author.name} på läktaren`" tabindex="-1">
          <Avatar :name="post.author.name" :design="post.author.avatar" />
        </NuxtLink>
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-baseline gap-x-2">
            <span v-if="onWall" class="font-semibold">{{ post.author.name }}</span>
            <NuxtLink v-else :to="authorPath" class="font-semibold underline-offset-2 hover:text-himmel hover:underline" :title="`${post.author.name} på läktaren`">{{ post.author.name }}</NuxtLink>
            <span v-if="onWall || noMentions" class="text-sm text-krita-dim">@{{ post.author.handle }}</span>
            <button v-else class="text-sm text-krita-dim hover:text-himmel" :title="`Nämn @${post.author.handle}`" @click="emit('mention', post.author.handle)">@{{ post.author.handle }}</button>
          </p>
          <p class="text-xs text-krita-dim">
            <TimeAgo :at="post.createdAt" />
            <span v-if="post.sport" class="capitalize"> · {{ post.sport }}</span>
          </p>
        </div>
      </div>
      <template v-if="post.own">
        <div v-if="confirming" class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs">
          <button class="font-bold text-rod hover:underline disabled:opacity-50" :disabled="removing" @click="remove">{{ removing ? 'Tar bort…' : 'Ja, ta bort för alla' }}</button>
          <button class="text-krita-dim hover:text-krita" :disabled="removing" @click="confirming = false; removeError = null">Avbryt</button>
        </div>
        <button v-else class="ml-auto text-xs text-krita-dim hover:text-rod" @click="confirming = true">Ta bort</button>
      </template>
    </header>
    <p v-if="removeError" class="mt-2 text-right text-xs font-semibold text-rod" role="alert">{{ removeError }}</p>

    <p class="mt-3 whitespace-pre-line text-[1.02rem] leading-relaxed">
      <template v-for="(t, i) in tokens" :key="i">
        <MentionLink v-if="t.type === 'mention'" :handle="t.value" />
        <button v-else-if="t.type === 'tag'" class="font-semibold text-guld hover:underline" @click="showTag(t.value)">#{{ t.value }}</button>
        <template v-else>{{ t.value }}</template>
      </template>
    </p>

    <!--
      Frozen at publication: the outlet's own headline and link, as they stood in its feed. Compact, so the
      supporter's words lead. "Story" while that Story is still in the feeds (then it can be opened);
      otherwise "Artikel": the original article, which is all we kept. Never another Story.
    -->
    <div v-if="frozen && lead" class="mt-3 flex gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
      <span aria-hidden="true" class="w-1 shrink-0 rounded-full" style="background: repeating-linear-gradient(180deg, var(--color-himmel) 0 4px, var(--color-navy-700) 4px 8px)" />
      <div class="min-w-0 flex-1">
        <!-- Each "· item" stays together, so a wrapped line never starts with a dot -->
        <p class="kicker flex flex-wrap items-baseline gap-x-1.5 text-krita-dim">
          <span class="whitespace-nowrap">{{ unlinked ? 'Artikel' : `Story · ${sourcesLabel(frozen.sources.length)}` }}</span>
          <span class="whitespace-nowrap">· {{ lead.outlet }}</span>
          <span v-if="lead.capturedAt" class="whitespace-nowrap">· {{ day(lead.capturedAt) }}</span>
        </p>
        <!-- The headline is the link to the original article; long Swedish headlines wrap rather than being cut -->
        <a
          v-if="linkable(lead.url)"
          :href="lead.url"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-1 block break-words text-pretty font-display text-[0.9rem] font-medium leading-snug text-krita/90 decoration-himmel/60 underline-offset-4 hover:text-himmel hover:underline"
          :title="`Läs hos ${lead.publisher || lead.outlet}`"
        >{{ lead.headline }}<span class="ml-1 text-krita-dim" aria-hidden="true">↗</span><span class="sr-only"> (läs hos {{ lead.outlet }})</span></a>
        <p v-else class="mt-1 break-words font-display text-[0.9rem] font-medium leading-snug text-krita/90">
          {{ lead.headline }} <span class="font-sans text-xs font-normal text-krita-dim">(länken finns inte kvar)</span>
        </p>
        <div v-if="live || frozen.sources.length > 1" class="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <button v-if="live" type="button" class="font-semibold text-himmel hover:underline" @click="showStory(live.id)">Visa Storyn →</button>
          <details v-if="frozen.sources.length > 1" class="text-krita-dim">
            <summary class="hover:text-krita">Alla {{ sourcesLabel(frozen.sources.length) }}</summary>
            <ul class="mt-1.5 space-y-1.5">
              <li v-for="s in frozen.sources" :key="s.key">
                <a v-if="linkable(s.url)" :href="s.url" target="_blank" rel="noopener noreferrer" class="break-words hover:text-himmel"><span class="font-semibold text-krita">{{ s.outlet }}:</span> {{ s.headline }} ↗</a>
                <span v-else class="break-words"><span class="font-semibold text-krita">{{ s.outlet }}:</span> {{ s.headline }} (länken finns inte kvar)</span>
              </li>
            </ul>
          </details>
        </div>
      </div>
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

    <!-- Kept with the post, but unreadable here: not a post from before frozen Stories, so never found by its id -->
    <p v-else-if="post.storyRefInvalid && unlinked" class="mt-4 rounded-2xl border border-dashed border-white/12 px-3 py-2.5 text-xs text-krita-dim">
      {{ NO_LIVE_STORY }}
    </p>

    <!-- …and after it has left them: we never kept a copy, so we don't guess -->
    <p v-else-if="gone" class="mt-4 rounded-2xl border border-dashed border-white/12 px-3 py-2.5 text-xs text-krita-dim">
      Inlägget handlade om en Story som inte längre finns i nyhetsflödena. Den sparades inte när inlägget skrevs.
    </p>

    <RealPostInteractions :post-id="post.id" />
  </article>
</template>
