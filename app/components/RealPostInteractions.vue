<script setup lang="ts">
import type { ReactionKey } from '#shared/types/domain'
import { REACTIONS } from '~/composables/useSnacket'

/*
 * Reactions and comments on a post, stored in Supabase. Counts are
 * everyone's, your highlight is yours, and nothing changes until Supabase
 * has confirmed it.
 */
const props = defineProps<{ postId: string }>()

const { identity, owner } = useSnacket()
const { stats, statsStatus, mine, pending, threads, sending, react, loadComments, addComment, removeComment } = useInteractions()
const accountOpen = useAccountDialog()
const { userId } = useAuth()

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

const open = ref(false)
function toggle() {
  open.value = !open.value
  if (open.value) void loadComments(props.postId)
}

const draft = ref('')
const sendError = ref<string | null>(null)
watch(draft, () => (sendError.value = null))
// A half-typed comment belongs to whoever typed it.
watch(owner, (_next, prev) => {
  if (prev) draft.value = ''
  invite.value = false
})

async function send() {
  if (!draft.value.trim() || sending.value[props.postId]) return
  const r = await addComment(props.postId, draft.value)
  if (r.ok) draft.value = ''
  else sendError.value = r.message // the text stays
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
    <button class="chip ml-auto border-transparent bg-white/[0.04] text-krita-dim hover:text-krita" :aria-expanded="open" @click="toggle">
      💬 <span class="tabular-nums">{{ s ? s.comments : '–' }}</span>
      <span class="hidden sm:inline">{{ open ? 'Dölj' : 'Kommentarer' }}</span>
    </button>
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

  <div v-if="open" class="mt-4 space-y-3 border-t border-white/8 pt-4">
    <p v-if="!thread || thread.status === 'loading'" class="text-sm text-krita-dim" aria-live="polite">Hämtar kommentarer…</p>
    <p v-else-if="thread.status === 'error'" class="text-sm text-krita-dim" role="alert">
      Kunde inte hämta kommentarerna.
      <button class="font-semibold text-himmel hover:underline" @click="loadComments(postId)">Försök igen</button>
    </p>
    <template v-else>
      <p v-if="!thread.list.length" class="text-sm text-krita-dim">Inga kommentarer än.</p>
      <!-- Capped thread: say so rather than imply the list is complete -->
      <p v-if="thread.more" class="text-xs text-krita-dim">Visar de {{ thread.list.length }} äldsta av {{ s ? s.comments : 'fler' }} kommentarer.</p>
      <div v-for="c in thread.list" :key="c.id" class="flex gap-2.5">
        <Avatar :name="c.author.name" size="sm" />
        <div class="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-white/[0.04] px-3.5 py-2.5">
          <p class="flex flex-wrap items-baseline gap-x-1.5 text-xs">
            <span class="font-semibold">{{ c.author.name }}</span>
            <span class="text-krita-dim">@{{ c.author.handle }} · <TimeAgo :at="c.createdAt" /></span>
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
              <span v-if="t.type === 'mention'" class="font-semibold text-himmel">@{{ t.value }}</span>
              <span v-else-if="t.type === 'tag'" class="font-semibold text-guld">#{{ t.value }}</span>
              <template v-else>{{ t.value }}</template>
            </template>
          </p>
          <p v-if="confirming === c.id && removeError" class="mt-1 text-xs font-semibold text-rod" role="alert">{{ removeError }}</p>
        </div>
      </div>
    </template>

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
  </div>
</template>
