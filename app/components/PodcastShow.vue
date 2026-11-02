<script setup lang="ts">
import type { PodcastEpisode, PodcastResponse } from '#shared/types/domain'

/*
 * Real episodes from the show's own RSS feed. Audio streams straight from
 * the enclosure the publisher distributes to podcast players; nothing is
 * downloaded until someone presses play.
 */
const props = defineProps<{ podcast: PodcastResponse, highlight?: boolean }>()

const root = useTemplateRef<HTMLElement>('root')
const audio = useTemplateRef<HTMLAudioElement>('audio')
const { current, playing, position, duration, progress, failed, mainVisible, attach, detach, toggle, seekFromClick: seek, seekFromKey: onSeekKey } = usePodcastPlayer()
const showAll = ref(false)

const latest = computed(() => props.podcast.episodes[0])
const more = computed(() => props.podcast.episodes.slice(1, showAll.value ? undefined : 4))

function minutes(sec?: number) {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

const isCurrent = (ep: PodcastEpisode) => current.value?.id === ep.id

// Tell the mini-player whether this, the main player, is on screen.
let observer: IntersectionObserver | undefined
onMounted(() => {
  if (audio.value) attach(audio.value, props.podcast.show?.title ?? 'Podden')
  if (root.value && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(([entry]) => (mainVisible.value = !!entry?.isIntersecting), { threshold: 0.15 })
    observer.observe(root.value)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  mainVisible.value = false
  if (audio.value) detach(audio.value)
})
</script>

<template>
  <article ref="root" class="card relative overflow-hidden" :class="highlight && 'border-guld/30'">
    <!-- The one and only audio element; the mini-player drives it too. -->
    <audio ref="audio" preload="none" />

    <div class="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      <MediaCover cover="night" :title="podcast.show?.title ?? ''" kind="podd" class="aspect-[16/9] lg:aspect-auto" />

      <div class="min-w-0 p-5 sm:p-7">
        <div class="flex flex-wrap items-center gap-2">
          <span class="kicker text-krita-dim">Podcast</span>
          <span class="kicker rounded-full bg-himmel/15 px-2 py-0.5 text-himmel">Riktiga avsnitt</span>
          <span v-if="highlight" class="kicker rounded-full bg-guld/15 px-2 py-0.5 text-guld">🌙 Perfekt läge just nu</span>
          <span v-if="podcast.status.stale" class="kicker rounded-full bg-guld/15 px-2 py-0.5 text-guld">Senast hämtade avsnitt</span>
        </div>
        <h4 class="mt-2 font-display text-3xl font-semibold leading-tight">
          <a :href="podcast.show?.url" target="_blank" rel="noopener" class="hover:underline decoration-himmel/60 underline-offset-4">{{ podcast.show?.title }}</a>
        </h4>
        <p v-if="podcast.show?.author" class="mt-1 text-sm text-krita-dim">{{ podcast.show.author }}</p>

        <!-- Latest episode, featured -->
        <div v-if="latest" class="mt-6 rounded-2xl border border-white/10 bg-navy-950/60 p-4 sm:p-5">
          <div class="flex items-start gap-4">
            <button
              v-if="latest.audioUrl"
              class="grid size-14 shrink-0 place-items-center rounded-full bg-guld text-navy-950 shadow-[0_10px_30px_-10px_rgb(244_196_48/0.8)] transition hover:scale-105 active:scale-95"
              :aria-label="isCurrent(latest) && playing ? `Pausa ${latest.title}` : `Spela ${latest.title}`"
              @click="toggle(latest)"
            >
              <svg v-if="isCurrent(latest) && playing" viewBox="0 0 24 24" class="size-6" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              <svg v-else viewBox="0 0 24 24" class="ml-1 size-6" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
            </button>
            <div class="min-w-0 flex-1">
              <p class="kicker text-guld">Senaste avsnittet · <TimeAgo :at="latest.publishedAt" /><template v-if="latest.durationSeconds"> · {{ minutes(latest.durationSeconds) }}</template></p>
              <p class="mt-1 font-display text-2xl font-semibold leading-tight">{{ latest.title }}</p>
              <p v-if="latest.excerpt" class="mt-2 text-sm leading-relaxed text-krita-dim">{{ latest.excerpt }}</p>
            </div>
          </div>

          <div v-if="isCurrent(latest)" class="mt-4">
            <div
              class="group/bar relative h-2 cursor-pointer rounded-full bg-white/10"
              role="slider"
              tabindex="0"
              aria-label="Position i avsnittet"
              :aria-valuenow="Math.round(position)"
              :aria-valuemax="Math.round(duration)"
              @click="seek"
              @keydown="onSeekKey"
            >
              <div class="stripes absolute inset-y-0 left-0 rounded-full [--stripe:6px]" :style="{ width: `${progress}%` }" />
            </div>
            <p class="mt-1.5 flex justify-between text-xs tabular-nums text-krita-dim"><span>{{ clock(position) }}</span><span>{{ duration ? clock(duration) : '' }}</span></p>
          </div>
        </div>

        <p v-if="failed" class="mt-3 text-sm text-rod" role="status">{{ failed }}</p>

        <!-- Earlier episodes -->
        <ul v-if="more.length" class="mt-4 divide-y divide-white/8">
          <li v-for="ep in more" :key="ep.id" class="flex items-center gap-3 py-3">
            <button
              v-if="ep.audioUrl"
              class="grid size-9 shrink-0 place-items-center rounded-full border transition"
              :class="isCurrent(ep) ? 'border-guld bg-guld text-navy-950' : 'border-white/15 hover:border-himmel hover:text-himmel'"
              :aria-label="isCurrent(ep) && playing ? `Pausa ${ep.title}` : `Spela ${ep.title}`"
              @click="toggle(ep)"
            >
              <svg v-if="isCurrent(ep) && playing" viewBox="0 0 24 24" class="size-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              <svg v-else viewBox="0 0 24 24" class="ml-0.5 size-4" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
            </button>
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold">{{ ep.title }}</p>
              <p class="text-xs text-krita-dim"><TimeAgo :at="ep.publishedAt" /><template v-if="ep.durationSeconds"> · {{ minutes(ep.durationSeconds) }}</template><template v-if="isCurrent(ep)"> · {{ clock(position) }}</template></p>
            </div>
            <a :href="ep.url" target="_blank" rel="noopener" class="shrink-0 text-xs font-semibold text-krita-dim hover:text-himmel">Öppna ↗</a>
          </li>
        </ul>
        <button v-if="podcast.episodes.length > 4" class="mt-1 text-sm font-semibold text-himmel hover:underline" @click="showAll = !showAll">
          {{ showAll ? 'Visa färre avsnitt' : `Visa ${podcast.episodes.length - 4} äldre avsnitt` }}
        </button>

        <p class="mt-5 text-xs leading-relaxed text-krita-dim">
          Avsnitt och ljud från podcastens eget RSS-flöde hos
          <a :href="podcast.show?.url" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-krita">pod.space</a><template v-if="podcast.show?.copyright"> · © {{ podcast.show.copyright }}</template>.
          Ljudet spelas direkt från podcastens server.
          <a v-if="latest" :href="latest.url" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-krita">Öppna senaste avsnittet hos podden ↗</a>
        </p>
      </div>
    </div>
  </article>
</template>
