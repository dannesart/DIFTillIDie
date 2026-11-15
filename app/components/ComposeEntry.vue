<script setup lang="ts">
import type { Story } from '#shared/types/domain'
import { draftAttachment, newsLoad, postDraftPreview, resolveAttachment } from '~/lib/postDraft'

/*
 * The way into writing a Snacket post: a compact card that opens the one
 * compose dialog (ComposeDialog) with the draft as it was left. Used at the
 * top of Snacket and on Hem; never a form of its own. Signed out, the dialog
 * itself invites you to log in, exactly as in Snacket.
 *
 * `story`: a post started here is about that Story (Snacket, filtered by one).
 * The sport is the one you're browsing, as in Snacket.
 */
const props = withDefaults(defineProps<{ prompt?: string, story?: Story, compact?: boolean }>(), {
  prompt: 'Vad snackas det om på stan?',
})

const { sport, me, identity } = useSnacket()
const { stories, status: newsStatus } = useNews()
const compose = useCompose()

const browsing = () => ({ sport: sport.value === 'alla' ? undefined : sport.value, story: props.story })
/** The draft in progress (text, or only an attached Story), shown in the entry so it's clear nothing was lost. */
const draftText = computed(() => {
  if (identity.value.kind === 'guest') return null
  const d = compose.post.value
  // The Story's headline now, or, when it can't be confirmed, the one the supporter chose
  const s = resolveAttachment(draftAttachment(d), stories.value, newsLoad(newsStatus.value))
  return postDraftPreview(d, s.kind === 'attached' || s.kind === 'confirm' ? leadOf(s.story).headline : d.headline)
})
</script>

<template>
  <button
    type="button"
    v-ripple="'himmel'"
    class="card relative flex w-full items-center gap-3 text-left transition hover:border-himmel/40"
    :class="compact ? 'rounded-full! p-2 pr-2.5 sm:p-2.5' : 'p-4 sm:p-5'"
    aria-haspopup="dialog"
    @click="compose.openPost(browsing())"
  >
    <Avatar :name="me?.name ?? 'Du'" :design="me?.avatar" :size="compact ? 'sm' : undefined" />
    <span class="min-w-0 flex-1">
      <span v-if="draftText" class="block text-xs font-semibold text-guld">Ditt utkast</span>
      <span v-if="draftText" class="block truncate text-krita">{{ draftText }}</span>
      <span v-else class="block truncate text-krita-dim" :class="compact ? 'text-[0.95rem]' : 'text-base'">{{ prompt }}</span>
    </span>
    <span aria-hidden="true" class="shrink-0 rounded-full bg-himmel px-4 py-2 text-sm font-bold text-navy-950">{{ draftText ? 'Fortsätt' : 'Skriv' }}</span>
  </button>
</template>
