<script setup lang="ts">
import type { ReactionKey } from '#shared/types/domain'
import type { FeedPost } from '~/composables/useSnacket'
import { REACTIONS } from '~/composables/useSnacket'

const props = defineProps<{ post: FeedPost }>()
const emit = defineEmits<{ mention: [handle: string] }>()

const { toggleReaction, addComment, remove, filter, me, identity, owner, community } = useSnacket()
const accountOpen = useAccountDialog()
const { show } = useStorySpotlight()
const { stories } = useNews()

const story = computed(() => stories.value.find(s => storyAnswersTo(s, props.post.storyId)))
const tokens = computed(() => tokenize(props.post.body))

const popped = ref<ReactionKey | null>(null)
function react(key: ReactionKey) {
  const had = props.post.mine.includes(key)
  toggleReaction(props.post.id, key)
  popped.value = had ? null : key
}

const open = ref(false)
const draft = ref('')
// A half-typed reply belongs to whoever typed it.
watch(owner, (_next, prev) => { if (prev) draft.value = '' })
function sendComment() {
  addComment(props.post.id, draft.value)
  draft.value = ''
}

// Deleting a real post is for everyone, so it asks first and waits for Supabase.
const confirming = ref(false)
const removing = ref(false)
const removeError = ref<string | null>(null)
async function removeReal() {
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
          <!-- A real supporter may pick the same name or handle as a fictional one; the card says which is which. -->
          <span v-if="post.demo" class="self-center rounded-full border border-guld/40 px-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-guld" title="Påhittad supporter i demo-snacket">påhittad</span>
          <button class="text-sm text-krita-dim hover:text-himmel" :title="`Nämn @${post.author.handle}`" @click="emit('mention', post.author.handle)">@{{ post.author.handle }}</button>
        </p>
        <p class="text-xs text-krita-dim">
          <span v-if="post.author.flair">{{ post.author.flair }} · </span>
          <TimeAgo :at="post.createdAt" />
          <span v-if="post.sport" class="capitalize"> · {{ post.sport }}</span>
          <span v-if="post.own && !post.real" title="Sparat bara i den här webbläsaren – ingen annan ser det"> · <span aria-hidden="true">🔒</span> bara här</span>
        </p>
      </div>
      <template v-if="post.own && post.real">
        <div v-if="confirming" class="flex shrink-0 items-center gap-2 text-xs">
          <button class="font-bold text-rod hover:underline disabled:opacity-50" :disabled="removing" @click="removeReal">{{ removing ? 'Tar bort…' : 'Ja, ta bort för alla' }}</button>
          <button class="text-krita-dim hover:text-krita" :disabled="removing" @click="confirming = false; removeError = null">Avbryt</button>
        </div>
        <button v-else class="text-xs text-krita-dim hover:text-rod" @click="confirming = true">Ta bort</button>
      </template>
      <button v-else-if="post.own" class="text-xs text-krita-dim hover:text-rod" @click="remove(post.id)">Ta bort</button>
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

    <footer v-if="!post.real" class="mt-4 flex flex-wrap items-center gap-1.5">
      <button
        v-for="r in REACTIONS"
        :key="r.key"
        class="chip border-transparent"
        :class="post.mine.includes(r.key) ? 'bg-himmel/15 text-himmel border-himmel/40' : 'bg-white/[0.04] text-krita-dim hover:bg-white/[0.08] hover:text-krita'"
        :aria-pressed="post.mine.includes(r.key)"
        :aria-label="`${r.label}, ${post.reactions[r.key]}`"
        @click="react(r.key)"
      >
        <span :key="`${r.key}-${post.reactions[r.key]}`" :class="popped === r.key && 'animate-pop'" class="inline-block">{{ r.emoji }}</span>
        <span class="tabular-nums">{{ post.reactions[r.key] }}</span>
      </button>
      <button class="chip ml-auto border-transparent bg-white/[0.04] text-krita-dim hover:text-krita" :aria-expanded="open" @click="open = !open">
        💬 <span class="tabular-nums">{{ post.comments.length }}</span>
        <span class="hidden sm:inline">{{ open ? 'Dölj' : 'Kommentarer' }}</span>
      </button>
    </footer>

    <div v-if="open && !post.real" class="mt-4 space-y-3 border-t border-white/8 pt-4">
      <div v-for="c in post.comments" :key="c.id" class="flex gap-2.5">
        <Avatar :name="c.author.name" size="sm" />
        <div class="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-white/[0.04] px-3.5 py-2.5">
          <p class="text-xs"><span class="font-semibold">{{ c.author.name }}</span> <span class="text-krita-dim">· <TimeAgo :at="c.createdAt" /></span></p>
          <p class="mt-0.5 text-sm leading-relaxed">
            <template v-for="(t, i) in tokenize(c.body)" :key="i">
              <span v-if="t.type === 'mention'" class="font-semibold text-himmel">@{{ t.value }}</span>
              <span v-else-if="t.type === 'tag'" class="font-semibold text-guld">#{{ t.value }}</span>
              <template v-else>{{ t.value }}</template>
            </template>
          </p>
        </div>
      </div>
      <p v-if="identity.kind === 'needs-profile'" class="text-sm text-krita-dim">
        <button class="font-semibold text-himmel hover:underline" @click="accountOpen = true">Välj ditt läktarnamn</button> för att svara.
      </p>
      <form v-else class="flex gap-2" @submit.prevent="sendComment">
        <input v-model="draft" maxlength="280" placeholder="Svara…" aria-label="Skriv en kommentar" class="min-w-0 flex-1 rounded-full border border-white/12 bg-navy-950 px-4 py-2 text-sm outline-none focus:border-himmel">
        <button class="rounded-full bg-krita px-4 text-sm font-bold text-navy-950 disabled:opacity-40" :disabled="!me || !draft.trim()">Skicka</button>
      </form>
    </div>
  </article>
</template>
