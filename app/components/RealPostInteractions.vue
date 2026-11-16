<script setup lang="ts">
import type { ReactionKey } from '#shared/types/domain'
import { REACTIONS } from '~/composables/useSnacket'
import { commentsLinkLabel } from '~/lib/interactions'
import { commentAnchor } from '~/lib/reveal'

/*
 * Reactions and comments on a post, stored in Supabase. Counts are
 * everyone's, your highlight is yours, and nothing changes until Supabase
 * has confirmed it.
 *
 * The conversation lives on the post's own page (/snacket/inlagg/<id>,
 * `conversation`): there the comments are always shown, with the comment
 * box. Everywhere else (Snacket, a läktarplats) the comment count is a link
 * to that page; the reactions work right where the post is.
 */
const props = defineProps<{
  postId: string
  /** On the post's own page: the comments, always shown. Elsewhere, a link to them. */
  conversation?: boolean
  /**
   * A comment to bring into view (a link to it: #comment-<id>), known to be
   * on this post. The thread opens and is read on, page by page, until it's
   * there; then it's scrolled to and briefly highlighted. Not found after all
   * (deleted meanwhile): `focused` says so, and nothing else is pointed at.
   */
  focusComment?: string | null
}>()
const emit = defineEmits<{ focused: [result: 'shown' | 'not-found' | 'error'] }>()

const { identity, owner } = useSnacket()
const { stats, statsStatus, mine, pending, threads, sending, react, loadComments, loadMoreComments, addComment, removeComment } = useInteractions()
const accountOpen = useAccountDialog()
const { userId } = useAuth()
const links = useSectionLinks()

const s = computed(() => stats.value[props.postId])
const busy = computed(() => !!pending.value[props.postId])
const myReaction = computed(() => mine.value[props.postId] ?? null)
const thread = computed(() => threads.value[props.postId])
const canInteract = computed(() => identity.value.kind === 'member')

/** Tapped while signed out (or without a name): a friendly way in, not an error. */
const invite = ref(false)
const reactError = ref<string | null>(null)
const popped = ref<ReactionKey | null>(null)

async function tap(key: ReactionKey) {
  reactError.value = null
  if (!canInteract.value) {
    invite.value = true
    return
  }
  const adding = myReaction.value !== key
  const r = await react(props.postId, key)
  if (!r.ok) reactError.value = r.message
  else popped.value = adding ? key : null
}


/** At most this many further pages are read looking for a comment (COMMENT_LIMIT each). */
const FOCUS_PAGES = 25
const highlighted = ref<string | null>(null)
let unhighlight: ReturnType<typeof setTimeout> | undefined
const loaded = (id: string) => !!threads.value[props.postId]?.list.some(c => c.id === id)
/** Read the thread on, page by page, until `id` is in it (or there's nothing more, or it fails). */
async function readOnTo(id: string) {
  for (let n = 0; !loaded(id) && threads.value[props.postId]?.more && n < FOCUS_PAGES; n++) {
    if (!(await loadMoreComments(props.postId))) break
  }
  return loaded(id)
}
/** Scroll to a comment that's in the list, focus it and outline it for a moment. */
async function show(id: string) {
  await nextTick()
  const el = document.getElementById(commentAnchor(id))
  el?.scrollIntoView({ block: 'center' })
  el?.focus({ preventScroll: true })
  highlighted.value = id
  clearTimeout(unhighlight)
  unhighlight = setTimeout(() => (highlighted.value = null), 2600)
}
/** A link to a comment: from the start of the thread, read on to it. */
async function focus(id: string) {
  await loadComments(props.postId)
  await readOnTo(id)
  if (props.focusComment !== id) return // another link meanwhile
  const thread = threads.value[props.postId]
  if (!loaded(id)) return emit('focused', thread?.status === 'error' || thread?.more ? 'error' : 'not-found')
  await show(id)
  emit('focused', 'shown')
}
// The conversation: its comments at once (a linked comment is looked for page by page, see focus()).
onMounted(() => {
  if (!props.conversation) return
  if (props.focusComment) void focus(props.focusComment)
  else void loadComments(props.postId)
})
watch(() => props.focusComment, (id) => {
  // Pointed elsewhere (or nowhere): the last one isn't the one any more.
  highlighted.value = null
  if (id) void focus(id)
})
onBeforeUnmount(() => clearTimeout(unhighlight))

const draft = ref('')
const sendError = ref<string | null>(null)
watch(draft, () => (sendError.value = null))
// A half-typed comment belongs to whoever typed it.
watch(owner, (_next, prev) => {
  if (prev) draft.value = ''
  invite.value = false
})

/**
 * Your comment, just published: where it is now, last in the thread. With
 * later comments not loaded yet, the thread is read on to it first (it's
 * never shown out of its place). If that can't be done, `published` says it
 * was published and links to it.
 */
const published = ref<string | null>(null)
async function send() {
  if (!draft.value.trim() || sending.value[props.postId]) return
  published.value = null
  const r = await addComment(props.postId, draft.value)
  if (!r.ok) return void (sendError.value = r.message) // the text stays
  draft.value = ''
  if (!props.conversation) return
  if (await readOnTo(r.id)) await show(r.id)
  else published.value = r.id
}

const confirming = ref<string | null>(null)
const removing = ref(false)
const removeError = ref<string | null>(null)
async function remove(commentId: string) {
  removing.value = true
  removeError.value = null
  const r = await removeComment(props.postId, commentId)
  removing.value = false
  if (r.ok) confirming.value = null
  else removeError.value = r.message
}

const count = (key: ReactionKey) => (s.value ? s.value.reactions[key] : null)
</script>

<template>
  <footer class="mt-4 flex flex-wrap items-center gap-1.5" :aria-busy="busy">
    <button
      v-for="r in REACTIONS"
      :key="r.key"
      class="chip border-transparent disabled:cursor-wait"
      :class="myReaction === r.key ? 'bg-himmel/15 text-himmel border-himmel/40' : 'bg-white/[0.04] text-krita-dim hover:bg-white/[0.08] hover:text-krita'"
      :aria-pressed="myReaction === r.key"
      :aria-label="`${r.label}, ${count(r.key) ?? 'okänt antal'}`"
      :disabled="busy"
      @click="tap(r.key)"
    >
      <span :key="`${r.key}-${count(r.key)}`" :class="popped === r.key && 'animate-pop'" class="inline-block">{{ r.emoji }}</span>
      <span class="tabular-nums">{{ count(r.key) ?? (statsStatus === 'error' ? '?' : '–') }}</span>
    </button>
    <!-- On the post's page, the comments are right below: the count is just that -->
    <span v-if="conversation" class="chip ml-auto border-transparent text-krita-dim">
      💬 <span class="tabular-nums">{{ s ? s.comments : '–' }}</span>
      <span class="hidden sm:inline">Kommentarer</span>
    </span>
    <!-- Elsewhere, the way to the conversation: its own page -->
    <NuxtLink v-else :to="links.postPage(postId)" class="chip ml-auto border-transparent bg-white/[0.04] text-krita-dim hover:text-krita" :aria-label="commentsLinkLabel(s?.comments)">
      💬 <span class="tabular-nums">{{ s ? s.comments : '–' }}</span>
      <span class="hidden sm:inline">Kommentarer</span>
    </NuxtLink>
  </footer>

  <p v-if="reactError" class="mt-2 text-xs font-semibold text-rod" role="alert">{{ reactError }}</p>

  <!-- Signed out or without a name: an invitation, never a dead button -->
  <div v-if="invite && !canInteract" class="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm" role="status">
    <template v-if="identity.kind === 'needs-profile'">
      <p class="min-w-0 flex-1">Välj ditt läktarnamn, så kan du reagera och kommentera.</p>
      <button class="rounded-full bg-guld px-4 py-1.5 text-xs font-bold text-navy-950" @click="accountOpen = true">Välj läktarnamn</button>
    </template>
    <template v-else>
      <p class="min-w-0 flex-1"><span class="font-semibold">Vill du vara med?</span> <span class="text-krita-dim">Logga in för att reagera och kommentera.</span></p>
      <button class="rounded-full bg-guld px-4 py-1.5 text-xs font-bold text-navy-950" @click="accountOpen = true">Logga in</button>
    </template>
    <button class="text-xs text-krita-dim hover:text-krita" aria-label="Stäng" @click="invite = false">✕</button>
  </div>

  <section v-if="conversation" class="mt-4 space-y-3 border-t border-white/8 pt-4" aria-label="Kommentarer">
    <!-- First the way to join in (or the way in), then the comments, oldest first -->
    <form v-if="canInteract" class="flex gap-2" @submit.prevent="send">
      <input
        v-model="draft"
        maxlength="400"
        placeholder="Skriv en kommentar…"
        aria-label="Skriv en kommentar"
        :readonly="!!sending[postId]"
        class="min-w-0 flex-1 rounded-full border bg-navy-950 px-4 py-2 text-sm outline-none focus:border-himmel"
        :class="sendError ? 'border-rod' : 'border-white/12'"
      >
      <button class="rounded-full bg-krita px-4 text-sm font-bold text-navy-950 disabled:opacity-40" :disabled="!draft.trim() || !!sending[postId]">
        {{ sending[postId] ? 'Skickar…' : 'Skicka' }}
      </button>
    </form>
    <p v-else-if="identity.kind === 'needs-profile'" class="text-sm text-krita-dim">
      <button class="font-semibold text-himmel hover:underline" @click="accountOpen = true">Välj ditt läktarnamn</button> för att kommentera.
    </p>
    <p v-else-if="identity.kind === 'guest'" class="text-sm text-krita-dim">
      <button class="font-semibold text-himmel hover:underline" @click="accountOpen = true">Logga in</button> för att kommentera.
    </p>
    <p v-if="sendError" class="text-xs font-semibold text-rod" role="alert">{{ sendError }}</p>
    <!-- Published, but the thread couldn't be read on to it just now: say so, and where it is -->
    <p v-else-if="published" class="text-xs text-krita-dim" role="status">
      Din kommentar är publicerad, sist i tråden.
      <NuxtLink :to="links.postPage(postId, published)" class="font-semibold text-himmel hover:underline">Visa den</NuxtLink>
    </p>

    <p v-if="!thread || thread.status === 'loading'" class="text-sm text-krita-dim" aria-live="polite">Hämtar kommentarer…</p>
    <p v-else-if="thread.status === 'error'" class="text-sm text-krita-dim" role="alert">
      Kunde inte hämta kommentarerna.
      <button class="font-semibold text-himmel hover:underline" @click="loadComments(postId)">Försök igen</button>
    </p>
    <template v-else>
      <p v-if="!thread.list.length" class="text-sm text-krita-dim">Inga kommentarer än.</p>
      <!-- Capped thread: say so rather than imply the list is complete -->
      <p v-if="thread.more" class="text-xs text-krita-dim">Visar de {{ thread.list.length }} äldsta av {{ s ? s.comments : 'fler' }} kommentarer.</p>
      <!-- A comment's own anchor (#comment-<id>), for links to it; focusable only from a link -->
      <div
        v-for="c in thread.list"
        :id="commentAnchor(c.id)"
        :key="c.id"
        tabindex="-1"
        class="scroll-below-header flex gap-2.5 rounded-2xl outline-none transition-shadow duration-700"
        :class="highlighted === c.id && 'shadow-[0_0_0_2px_var(--color-guld)]'"
      >
        <NuxtLink :to="links.supporter(c.author.handle)" class="shrink-0 self-start rounded-full transition hover:scale-105" tabindex="-1" :aria-label="`${c.author.name} på läktaren`">
          <Avatar :name="c.author.name" :design="c.author.avatar" size="sm" />
        </NuxtLink>
        <div class="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-white/[0.04] px-3.5 py-2.5">
          <p class="flex flex-wrap items-baseline gap-x-1.5 text-xs">
            <NuxtLink :to="links.supporter(c.author.handle)" class="font-semibold underline-offset-2 hover:text-himmel hover:underline">{{ c.author.name }}</NuxtLink>
            <span class="text-krita-dim">@{{ c.author.handle }} · <NuxtLink :to="links.postPage(postId, c.id)" class="underline-offset-2 hover:text-krita hover:underline" title="Länk till kommentaren"><TimeAgo :at="c.createdAt" /></NuxtLink></span>
            <template v-if="c.author.id === userId">
              <span v-if="confirming === c.id" class="ml-auto flex gap-2">
                <button class="font-bold text-rod hover:underline disabled:opacity-50" :disabled="removing" @click="remove(c.id)">{{ removing ? 'Tar bort…' : 'Ja, ta bort' }}</button>
                <button class="text-krita-dim hover:text-krita" :disabled="removing" @click="confirming = null; removeError = null">Avbryt</button>
              </span>
              <button v-else class="ml-auto text-krita-dim hover:text-rod" @click="confirming = c.id; removeError = null">Ta bort</button>
            </template>
          </p>
          <p class="mt-0.5 whitespace-pre-line text-sm leading-relaxed">
            <template v-for="(t, i) in tokenize(c.body)" :key="i">
              <MentionLink v-if="t.type === 'mention'" :handle="t.value" />
              <span v-else-if="t.type === 'tag'" class="font-semibold text-guld">#{{ t.value }}</span>
              <template v-else>{{ t.value }}</template>
            </template>
          </p>
          <p v-if="confirming === c.id && removeError" class="mt-1 text-xs font-semibold text-rod" role="alert">{{ removeError }}</p>
        </div>
      </div>
      <!-- The rest of a capped thread, a page at a time -->
      <button
        v-if="thread.more"
        class="text-sm font-semibold text-himmel hover:underline disabled:opacity-50"
        :disabled="thread.loadingMore"
        @click="loadMoreComments(postId)"
      >
        {{ thread.loadingMore ? 'Hämtar…' : 'Visa fler kommentarer' }}
      </button>
    </template>
  </section>
</template>
