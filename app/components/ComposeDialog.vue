<script setup lang="ts">
import { postAnchor, revealPost } from '~/lib/reveal'

/*
 * The compose dialog: one shared, native <dialog> for writing, two ways
 * (see useCompose), each with its own draft:
 *  - "Snacka om detta": about a Story, which it shows in miniature;
 *  - a Snacket post, opened from "Vad snackas det om på stan?" or an
 *    @mention, with sport and an optional Story chosen in the composer.
 * showModal() gives us a real modal for free — inert background, focus kept
 * inside, Escape to close. Desktop: a centred card. Mobile: a bottom sheet.
 * Drafts are saved as you type, so closing (Escape, ✕, a tap outside) never
 * loses one. While a post is on its way it can't be closed, so its result
 * (published, or an error with the text kept) always lands here.
 */
const { activeId, postOpen, post, postResumed, draftFor, setDraft, setPost, close } = useCompose()
const { stories } = useNews()
const { postsForStory, filter, identity } = useSnacket()
const { publishing } = useCommunity()
const links = useSectionLinks()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const composer = useTemplateRef<{ focus: () => void }>('composer')

const story = computed(() => (activeId.value ? findStory(stories.value, activeId.value!) : undefined))
const lead = computed(() => (story.value ? leadOf(story.value) : undefined))
const earlier = computed(() => (story.value ? postsForStory(story.value) : []))
/** What it's open for: a Story, a Snacket post, or nothing. */
const mode = computed(() => (story.value && lead.value ? 'story' : postOpen.value ? 'post' : null))

const draft = computed({
  get: () => (activeId.value ? draftFor(activeId.value) : ''),
  set: v => activeId.value && setDraft(activeId.value, v),
})

const restored = ref(false)
const published = ref<{ id: string, text: string } | null>(null)
let opener: HTMLElement | null = null

watch(mode, async (now, before) => {
  const el = dialog.value
  if (!el) return
  if (now) {
    published.value = null
    restored.value = now === 'story' ? !!draft.value : postResumed.value
    // From one way of writing straight to the other: focus still goes back to the first opener.
    if (!before) opener = document.activeElement as HTMLElement | null
    if (!el.open) el.showModal()
    document.documentElement.classList.add('dialog-open')
    await nextTick()
    composer.value?.focus()
  }
  else if (el.open) {
    el.close()
  }
})

// Escape. Not while a post is on its way: it stays until Supabase has answered.
function onCancel(e: Event) {
  if (publishing.value) e.preventDefault()
}

// Fires for Escape, the close button and backdrop taps alike.
function onClose() {
  document.documentElement.classList.remove('dialog-open')
  opener?.focus({ preventScroll: true })
  // Closed anyway mid-publish (a browser may insist): keep the composer until
  // the answer is in, so a published post still clears its draft.
  if (publishing.value) {
    const stop = watch(publishing, (busy) => {
      if (busy) return
      stop()
      setTimeout(() => { if (!dialog.value?.open) close() })
    })
    return
  }
  if (mode.value) close()
}

function dismiss() {
  if (!publishing.value) close()
}

// A tap on the backdrop lands on the <dialog> itself, outside its box.
function onClick(e: MouseEvent) {
  const el = dialog.value
  if (!el || e.target !== el) return
  const r = el.getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dismiss()
}

function onPublished(id: string, text: string) {
  published.value = { id, text }
  // The composer already emptied the Snacket draft (text and Story); the sport stays for next time.
  if (activeId.value) setDraft(activeId.value, '')
  nextTick(() => document.getElementById('compose-done')?.focus())
}

/** To Snacket: about this Story, or the post just published (at the top, on Nyast). */
function toSnacket() {
  const storyId = mode.value === 'story' ? story.value?.id : undefined
  const postId = mode.value === 'post' ? published.value?.id : undefined
  close()
  if (storyId) filter.value = { storyId }
  // A jump the reader asked for — never one that happens on its own. (A
  // post's classic address is its place in Snacket on every screen.)
  if (!links.value.shows('snacket')) return void navigateTo(postId ? `/#${postAnchor(postId)}` : links.value.section('snacket'))
  requestAnimationFrame(() => {
    if (postId) void revealPost(postId)
    else document.getElementById('snacket')?.scrollIntoView({ behavior: 'smooth' })
  })
}

onBeforeUnmount(() => document.documentElement.classList.remove('dialog-open'))
</script>

<template>
  <dialog
    ref="dialog"
    class="compose-dialog text-krita"
    aria-labelledby="compose-title"
    aria-describedby="compose-note"
    @cancel="onCancel"
    @close="onClose"
    @click="onClick"
  >
    <div v-if="mode" class="relative flex max-h-[inherit] flex-col overflow-hidden">
      <div class="stripes h-1.5 shrink-0 [--stripe:10px]" aria-hidden="true" />
      <!-- Grab handle on phones -->
      <div class="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />

      <div class="overflow-y-auto overscroll-contain px-5 pb-5 pt-3 sm:px-7 sm:pb-7 sm:pt-5">
        <div class="flex items-center justify-between gap-3">
          <h2 id="compose-title" class="kicker text-guld">
            {{ published ? 'Publicerat' : mode === 'story' ? 'Snacka om detta' : 'Snacka om det' }}
          </h2>
          <button class="grid size-9 place-items-center rounded-full text-krita-dim transition enabled:hover:bg-white/10 enabled:hover:text-krita disabled:opacity-40" aria-label="Stäng (ditt utkast sparas)" :disabled="publishing" @click="dismiss">
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <!-- The Story, in miniature -->
        <div v-if="story && lead && mode === 'story'" class="mt-3 rounded-2xl border border-white/10 bg-navy-950/60 p-4">
          <p class="kicker flex items-center gap-2 text-krita-dim">
            <span class="size-1.5 rounded-full" :class="story.sport === 'hockey' ? 'bg-himmel-200' : 'bg-himmel'" />
            {{ story.sport === 'hockey' ? 'Hockey' : 'Fotboll' }} · {{ lead.outlet }} · <TimeAgo :at="lead.publishedAt" />
          </p>
          <p class="mt-1.5 line-clamp-2 font-display text-lg font-semibold leading-snug">{{ lead.headline }}</p>
          <p class="mt-1.5 text-xs text-krita-dim">
            {{ story.sources.length }} {{ story.sources.length === 1 ? 'källa' : 'källor' }} ·
            <a :href="lead.url" target="_blank" rel="noopener" class="underline decoration-white/30 underline-offset-2 hover:text-krita">läs hos {{ lead.outlet }} ↗</a>
          </p>
        </div>

        <template v-if="!published">
          <p v-if="restored && identity.kind !== 'guest' && (mode === 'story' ? draft : post.body.trim())" class="mt-3 text-xs font-semibold text-guld">Ditt utkast finns kvar.</p>
          <PostComposer v-if="mode === 'story'" ref="composer" v-model:body="draft" :story="story" class="mt-3" @published="onPublished" />
          <PostComposer
            v-else
            ref="composer"
            :body="post.body"
            :sport="post.sport"
            :story-id="post.storyId"
            class="mt-3"
            @update:body="setPost({ body: $event })"
            @update:sport="setPost({ sport: $event })"
            @update:story-id="setPost({ storyId: $event })"
            @published="onPublished"
          />
          <div class="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-krita-dim">
            <p id="compose-note">Ditt utkast sparas medan du skriver. Publicerade inlägg syns för alla i Snacket på stan.</p>
            <button v-if="earlier.length && mode === 'story'" class="font-semibold hover:text-krita" @click="toSnacket">
              {{ earlier.length }} {{ earlier.length === 1 ? 'inlägg' : 'inlägg' }} om detta →
            </button>
          </div>
        </template>

        <!-- The satisfying bit -->
        <div v-else class="py-6 text-center" role="status">
          <svg viewBox="0 0 52 52" class="done-check mx-auto size-16" aria-hidden="true">
            <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="3" class="text-guld" />
            <path d="M15 27l7 7 15-16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="text-guld" />
          </svg>
          <p class="mt-4 font-display text-3xl font-bold">Ute på stan<span class="text-rod">!</span></p>
          <p class="mx-auto mt-3 max-w-sm whitespace-pre-line break-words rounded-2xl bg-white/[0.05] px-4 py-3 text-left text-sm leading-relaxed">”{{ published.text }}”</p>
          <p id="compose-note" class="mt-3 text-xs text-krita-dim">Publicerat i Snacket på stan – nu kan alla se det.</p>
          <div class="mt-6 flex flex-wrap justify-center gap-2">
            <button id="compose-done" class="rounded-full bg-guld px-6 py-2.5 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" @click="close()">Klar</button>
            <button class="rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold transition hover:border-himmel hover:text-himmel" @click="toSnacket">
              {{ mode === 'post' ? 'Visa inlägget' : 'Visa i Snacket' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.compose-dialog {
  /* Mobile: a bottom sheet */
  position: fixed;
  inset: auto 0 0 0;
  margin: 0;
  width: 100%;
  max-width: 100%;
  max-height: 92dvh;
  padding: 0 0 env(safe-area-inset-bottom);
  border: 1px solid rgb(255 255 255 / 0.1);
  border-bottom: 0;
  border-radius: 1.5rem 1.5rem 0 0;
  background: var(--color-navy-900);
  box-shadow: 0 -24px 80px -20px rgb(3 9 21 / 0.9);
}
@media (min-width: 640px) {
  /* Desktop: a centred card */
  .compose-dialog {
    inset: 0;
    margin: auto;
    width: min(34rem, calc(100% - 3rem));
    height: fit-content;
    max-height: min(44rem, calc(100dvh - 4rem));
    padding: 0;
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 1.75rem;
    box-shadow: 0 40px 120px -30px rgb(3 9 21 / 0.95);
  }
}
.compose-dialog::backdrop {
  background: rgb(3 9 21 / 0.65);
  backdrop-filter: blur(6px);
}
@media (prefers-reduced-motion: no-preference) {
  .compose-dialog[open] { animation: sheet-in 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
  .compose-dialog[open]::backdrop { animation: fade-in 0.3s ease-out; }
  .done-check circle { stroke-dasharray: 151; stroke-dashoffset: 151; animation: draw 0.6s 0.05s ease-out forwards; }
  .done-check path { stroke-dasharray: 40; stroke-dashoffset: 40; animation: draw 0.35s 0.5s ease-out forwards; }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 640px) {
  .compose-dialog[open] { animation-name: pop-in; }
}
@keyframes sheet-in { from { transform: translateY(100%); } }
@keyframes pop-in { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
@keyframes fade-in { from { opacity: 0; } }
@keyframes draw { to { stroke-dashoffset: 0; } }
</style>
