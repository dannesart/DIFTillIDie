<script setup lang="ts">
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FeedPost } from '~/composables/useSnacket'
import { commentFromHash, createSinglePost } from '~/lib/singlePost'

/*
 * Shell view: one Snacket post on a page of its own, /snacket/inlagg/<id>
 * (and #comment-<id> for one of its comments). Read straight from Supabase
 * by its id, so a link works for any post, not only those among Snacket's
 * newest. The home of its conversation: the same post card as in the feed,
 * with its comments always shown (and the comment box).
 * Loaded in the browser only, like the feed: the cached HTML is the same
 * empty page for everyone. The shell keys views by path, so another post is
 * always a fresh instance.
 */
const route = useRoute()
const links = useSectionLinks()
const nuxt = useNuxtApp()
const single = createSinglePost((nuxt.$supabase as SupabaseClient | null | undefined) ?? null, String(route.params.postId))
const { status, post, comment } = single
const { userId } = useAuth()
const interactions = useInteractions()
const { identity } = useSnacket()
const compose = useCompose()
const accountOpen = useAccountDialog()

/** The comment the address points at (#comment-<id>), if any. */
const wanted = computed(() => commentFromHash(route.hash))
const badCommentLink = computed(() => route.hash.startsWith('#comment-') && !wanted.value)
/** Found and shown, or why not. */
const focusResult = ref<'shown' | 'not-found' | 'error' | null>(null)
/** Passed on only once the comment is known to be on this post. */
const focus = computed(() => (comment.value === 'present' ? wanted.value : null))

const feedPost = computed<FeedPost | null>(() => post.value && { ...post.value, own: !!userId.value && post.value.author.id === userId.value })

onMounted(() => {
  void single.load()
  void single.checkComment(wanted.value)
})
// Another comment on the same page (a comment's own link, back/forward): look again.
watch(wanted, (id) => {
  focusResult.value = null
  void single.checkComment(id)
})
// Real reactions and comment counts for it, and your own reaction (yours: again when the account changes).
watch(post, (p) => {
  if (!p) return
  void interactions.loadStats([p.id])
  void interactions.loadMine([p.id])
})
watch(userId, () => post.value && void interactions.loadMine([post.value.id]))

function mention(handle: string) {
  if (identity.value.kind === 'guest') accountOpen.value = true
  else compose.mention(handle, { sport: post.value?.sport })
}

useSeoMeta({
  title: () => (post.value ? `Inlägg av ${post.value.author.name} – Djurgår’n tills jag dör` : 'Inlägg – Djurgår’n tills jag dör'),
  // Supporters' posts are for the stands, not for search engines.
  robots: 'noindex, nofollow',
})
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 pb-24 pt-4 sm:px-6 lg:pt-10">
    <NuxtLink :to="links.section('snacket')" class="text-sm font-semibold text-krita-dim hover:text-krita">
      <span aria-hidden="true">←</span> Snacket på stan
    </NuxtLink>
    <h1 class="sr-only">{{ feedPost ? `Inlägg av ${feedPost.author.name}` : 'Inlägg' }}</h1>

    <div class="mt-4" :aria-busy="status === 'idle' || status === 'loading'">
      <!-- Loading: a placeholder, never invented content -->
      <div v-if="status === 'idle' || status === 'loading'" class="card h-40 animate-pulse bg-white/[0.03]" aria-label="Hämtar inlägget" />

      <div v-else-if="status === 'error'" class="card p-6 text-sm" role="alert">
        <p>Kunde inte hämta inlägget just nu.</p>
        <button class="mt-2 font-semibold text-himmel hover:underline" @click="single.load()">Försök igen</button>
      </div>

      <div v-else-if="status === 'removed'" class="card p-6 text-center" role="status">
        <p class="font-semibold">Inlägget är borttaget.</p>
        <NuxtLink :to="links.section('snacket')" class="mt-3 inline-block text-sm font-semibold text-himmel hover:underline">Till Snacket</NuxtLink>
      </div>

      <!-- Deleted, never was, or not a post address: all the same, said plainly -->
      <div v-else-if="status === 'missing' || !feedPost" class="card p-6 text-center">
        <p class="font-semibold">Inlägget finns inte.</p>
        <p class="mt-1 text-sm text-krita-dim">Det kan ha tagits bort av den som skrev det.</p>
        <NuxtLink :to="links.section('snacket')" class="mt-3 inline-block text-sm font-semibold text-himmel hover:underline">Till Snacket</NuxtLink>
      </div>

      <template v-else>
        <!-- A comment link whose comment isn't here: say so, and point at nothing else -->
        <p v-if="comment === 'missing' || badCommentLink || focusResult === 'not-found'" class="mb-3 rounded-2xl border border-dashed border-white/12 px-4 py-3 text-sm text-krita-dim" role="status">
          Kommentaren finns inte längre. Den kan ha tagits bort.
        </p>
        <p v-else-if="comment === 'error' || focusResult === 'error'" class="mb-3 rounded-2xl border border-dashed border-white/12 px-4 py-3 text-sm text-krita-dim" role="alert">
          Kunde inte visa kommentaren just nu.
          <button class="font-semibold text-himmel hover:underline" @click="focusResult = null; single.checkComment(wanted)">Försök igen</button>
        </p>
        <PostCard
          :post="feedPost"
          conversation
          :focus-comment="focus"
          @mention="mention"
          @removed="single.removed()"
          @focused="r => (focusResult = r)"
        />
      </template>
    </div>
  </div>
</template>
