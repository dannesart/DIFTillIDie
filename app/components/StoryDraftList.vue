<script setup lang="ts">
import type { Story } from '#shared/types/domain'
import type { AttachmentState, NewsLoad } from '~/lib/postDraft'
import { draftAttachment, resolveAttachment } from '~/lib/postDraft'
import type { StoryDraft } from '~/lib/storyDrafts'

/*
 * Story drafts to choose from, in the compose dialog (Issue #25): each with
 * its own text, what it's about (the Story now, or the headline the supporter
 * chose when it can't be found), and where it stands. Choosing one opens
 * that draft, and only that one; drafts are never merged.
 */
const props = defineProps<{ drafts: StoryDraft[], stories: Story[], news: NewsLoad }>()
const emit = defineEmits<{ open: [draft: StoryDraft] }>()

const items = computed(() => props.drafts.map((d) => {
  const state = resolveAttachment(draftAttachment(d), props.stories, props.news)
  return { d, state, about: about(d, state), status: status(state) }
}))

function about(d: StoryDraft, s: AttachmentState) {
  if (s.kind === 'attached') return `Om: ”${leadOf(s.story).headline}”`
  if (s.kind === 'confirm') return `Om: ”${leadOf(s.story).headline}”?`
  if (s.kind === 'none') return 'Ingen Story kopplad'
  return d.headline ? `Om: ”${d.headline}”${d.outlet ? ` (${d.outlet})` : ''}` : 'En tidigare vald Story'
}

function status(s: AttachmentState): { text: string, tone: 'ok' | 'ask' | 'quiet' } {
  switch (s.kind) {
    case 'attached': return s.changed ? { text: 'Storyn har ändrats', tone: 'quiet' } : { text: 'Storyn finns kvar', tone: 'ok' }
    case 'confirm': return { text: 'Äldre utkast – bekräfta Storyn', tone: 'ask' }
    case 'missing': return { text: 'Storyn finns inte kvar', tone: 'ask' }
    case 'loading': return { text: 'Nyheterna laddas…', tone: 'quiet' }
    case 'unavailable': return { text: 'Nyheterna kunde inte hämtas', tone: 'quiet' }
    default: return { text: 'Publiceras som ett vanligt inlägg', tone: 'quiet' }
  }
}

const list = useTemplateRef<HTMLUListElement>('list')
/** Into the list, at the first draft. */
const focus = () => list.value?.querySelector('button')?.focus({ preventScroll: true })
defineExpose({ focus })
</script>

<template>
  <ul ref="list" class="grid gap-2">
    <li v-for="{ d, about: on, status: st } in items" :key="d.id">
      <button
        type="button"
        class="w-full rounded-2xl border border-white/10 bg-navy-950/60 px-4 py-3 text-left transition hover:border-himmel/40"
        @click="emit('open', d)"
      >
        <span class="line-clamp-3 whitespace-pre-line break-words text-sm text-krita">{{ d.body }}</span>
        <span class="mt-1.5 block break-words text-xs text-krita-dim"><span aria-hidden="true">📎</span> {{ on }}</span>
        <span class="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
          <span class="font-semibold" :class="st.tone === 'ask' ? 'text-guld' : st.tone === 'ok' ? 'text-himmel' : 'text-krita-dim'">{{ st.text }}</span>
          <span v-if="d.updatedAt" class="text-krita-dim">· sparat <TimeAgo :at="d.updatedAt" /></span>
          <span class="ml-auto font-bold text-krita">Fortsätt <span aria-hidden="true">→</span></span>
        </span>
      </button>
    </li>
  </ul>
</template>
