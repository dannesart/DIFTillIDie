<script setup lang="ts">
import type { PodcastEpisode } from '#shared/types/domain'

/*
 * The shell's contextual sidebar: what's coming up while you read.
 * The next match (the hero's card) and the newest real episodes, which play
 * through the page's one <audio> element like everywhere else. Optional: it
 * only appears where the screen has room for it (see AppShell.vue).
 */
defineProps<{ episodes?: boolean }>()

const links = useSectionLinks()
const { data } = usePodcasts()
const { current, playing, toggle } = usePodcastPlayer()

const latest = computed(() => (data.value?.shows ?? [])
  .flatMap(s => s.episodes.slice(0, 3).map(ep => ({ ep, show: { id: s.id, title: s.show?.title ?? s.status.outlet } })))
  .sort((a, b) => (b.ep.publishedAt ?? '').localeCompare(a.ep.publishedAt ?? ''))
  .slice(0, 4))

const isPlaying = (ep: PodcastEpisode) => current.value?.id === ep.id && playing.value
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) : '')
</script>

<template>
  <div class="space-y-6 px-5 py-6">
    <section aria-labelledby="rail-match">
      <h2 id="rail-match" class="sr-only">Nästa match</h2>
      <MatchCard />
    </section>

    <section v-if="episodes && latest.length" aria-labelledby="rail-listen">
      <div class="flex items-baseline justify-between px-1">
        <h2 id="rail-listen" class="kicker text-krita-dim">Senaste avsnitten</h2>
        <NuxtLink :to="links.view('lyssna')" class="text-xs font-semibold text-himmel hover:underline">Alla poddar</NuxtLink>
      </div>
      <ul class="mt-3 divide-y divide-white/6 rounded-3xl border border-white/8 bg-navy-900/50">
        <li v-for="{ ep, show } in latest" :key="ep.id" class="flex items-center gap-3 p-3">
          <button
            class="grid size-9 shrink-0 place-items-center rounded-full transition hover:scale-105 active:scale-95 disabled:opacity-40"
            :class="isPlaying(ep) ? 'bg-guld text-navy-950' : 'bg-white/[0.08] text-krita hover:bg-himmel hover:text-navy-950'"
            :disabled="!ep.audioUrl"
            :aria-label="isPlaying(ep) ? `Pausa ${ep.title}` : `Spela ${ep.title}`"
            @click="toggle(ep, show)"
          >
            <svg v-if="isPlaying(ep)" viewBox="0 0 24 24" class="size-3.5" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            <svg v-else viewBox="0 0 24 24" class="ml-0.5 size-3.5" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
          </button>
          <span class="min-w-0">
            <span class="line-clamp-2 text-sm font-semibold leading-snug">{{ ep.title }}</span>
            <span class="block truncate text-xs text-krita-dim">{{ show.title }} · {{ day(ep.publishedAt) }}</span>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
