<script setup lang="ts">
import type { PodcastEpisode, PodcastResponse } from '#shared/types/domain'

/*
 * One show's real episodes, from its own RSS feed. Audio streams straight
 * from the enclosures the publisher distributes to podcast players, through
 * the page's single <audio> element. Nothing loads until someone presses play.
 * If the feed can't be reached, the card says so and offers direct links.
 */
const props = defineProps<{ podcast: PodcastResponse, highlight?: boolean }>()

const root = useTemplateRef<HTMLElement>('root')
const { current, currentShow, playing, position, duration, progress, failed, visibleShow, toggle: togglePlayer, seekFromClick: seek, seekFromKey: onSeekKey, progressFor } = usePodcastPlayer()
const showAll = ref(false)

const title = computed(() => props.podcast.show?.title ?? props.podcast.status.outlet)
const latest = computed(() => props.podcast.episodes[0])
const more = computed(() => props.podcast.episodes.slice(1, showAll.value ? undefined : 4))
const host = computed(() => {
  try { return new URL(props.podcast.show?.url ?? props.podcast.status.homepage).hostname.replace(/^(www|shows)\./, '') }
  catch { return 'poddens sida' }
})
const isThisShowPlaying = computed(() => currentShow.value?.id === props.podcast.id)

function minutes(sec?: number) {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

const isCurrent = (ep: PodcastEpisode) => current.value?.id === ep.id
const toggle = (ep: PodcastEpisode) => togglePlayer(ep, { id: props.podcast.id, title: title.value })

// Tell the mini-player whether this show's card is on screen.
let observer: IntersectionObserver | undefined
onMounted(() => {
  if (root.value && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) visibleShow.value = props.podcast.id
      else if (visibleShow.value === props.podcast.id) visibleShow.value = null
      // "On screen" = crossing the middle band of the viewport, so a card taller
      // than a phone screen still counts while you're looking at it.
    }, { rootMargin: '-35% 0px -35% 0px', threshold: 0 })
    observer.observe(root.value)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (visibleShow.value === props.podcast.id) visibleShow.value = null
})
</script>

<template>
  <article ref="root" class="card relative overflow-hidden" :class="highlight && 'border-guld/30'">
    <!-- The cover never takes more than a third: the same 18rem on the front page (the card is ≥ 976px there), room for the episode in a narrower column -->
    <div class="grid lg:grid-cols-[min(18rem,33%)_minmax(0,1fr)]">
      <MediaCover :cover="podcast.cover" :title="title" kind="podd" class="aspect-[16/9] lg:aspect-auto" />

      <div class="min-w-0 p-5 sm:p-7">
        <div class="flex flex-wrap items-center gap-2">
          <span class="kicker text-krita-dim">Podcast</span>
          <span v-if="podcast.episodes.length" class="kicker rounded-full bg-himmel/15 px-2 py-0.5 text-himmel">Riktiga avsnitt</span>
          <span v-if="podcast.newcomer" class="kicker rounded-full bg-guld/15 px-2 py-0.5 text-guld">Ny här 💙</span>
          <span v-if="highlight" class="kicker rounded-full bg-guld/15 px-2 py-0.5 text-guld">🌙 Perfekt läge just nu</span>
          <span v-if="podcast.status.stale" class="kicker rounded-full bg-guld/15 px-2 py-0.5 text-guld">Senast hämtade avsnitt</span>
        </div>
        <h4 class="mt-2 font-display text-3xl font-semibold leading-tight">
          <a :href="podcast.show?.url ?? podcast.status.homepage" target="_blank" rel="noopener" class="hover:underline decoration-himmel/60 underline-offset-4">{{ title }}</a>
        </h4>
        <p class="mt-1 text-sm text-krita-dim">
          <template v-if="podcast.hosts || podcast.show?.author">{{ podcast.hosts ?? podcast.show?.author }} · </template>{{ podcast.tagline }}
        </p>

        <!-- Feed unreachable: be honest, and still get people listening -->
        <div v-if="!podcast.episodes.length" class="mt-6 rounded-2xl border border-white/10 bg-navy-950/60 p-5">
          <p class="font-display text-xl font-semibold">Vi når inte poddens flöde just nu.</p>
          <p class="mt-1 text-sm text-krita-dim">Lyssna direkt hos podden så länge – vi visar avsnitten här igen när flödet svarar.</p>
          <div class="mt-4 flex flex-wrap gap-2">
            <a v-for="l in podcast.links" :key="l.url" :href="l.url" target="_blank" rel="noopener" class="chip border-white/12 hover:border-himmel hover:text-himmel">{{ l.label }} ↗</a>
          </div>
        </div>

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
              <!-- Its own listening progress (the playing one shows its live position below) -->
              <EpisodeProgressMark v-if="!isCurrent(latest)" :progress="progressFor(latest)" />
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

        <p v-if="failed && isThisShowPlaying" class="mt-3 text-sm text-rod" role="status">{{ failed }}</p>

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
              <EpisodeProgressMark v-if="!isCurrent(ep)" :progress="progressFor(ep)" />
            </div>
            <a :href="ep.url" target="_blank" rel="noopener" class="shrink-0 text-xs font-semibold text-krita-dim hover:text-himmel">Öppna ↗</a>
          </li>
        </ul>
        <button v-if="podcast.episodes.length > 4" class="mt-1 text-sm font-semibold text-himmel hover:underline" @click="showAll = !showAll">
          {{ showAll ? 'Visa färre avsnitt' : `Visa ${podcast.episodes.length - 4} äldre avsnitt` }}
        </button>

        <template v-if="podcast.episodes.length">
          <div class="mt-5 flex flex-wrap items-center gap-2">
            <span class="kicker text-krita-dim">Lyssna även på</span>
            <a v-for="l in podcast.links" :key="l.url" :href="l.url" target="_blank" rel="noopener" class="chip border-white/12 hover:border-himmel hover:text-himmel">{{ l.label }} ↗</a>
          </div>
          <p class="mt-4 text-xs leading-relaxed text-krita-dim">
            Avsnitt och ljud från poddens eget RSS-flöde hos
            <a :href="podcast.show?.url" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-krita">{{ host }}</a><template v-if="podcast.show?.copyright"> · © {{ podcast.show.copyright }}</template>.
            Ljudet spelas direkt från poddens server.
            <a v-if="latest" :href="latest.url" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-krita">Öppna senaste avsnittet hos podden ↗</a>
          </p>
        </template>
      </div>
    </div>
  </article>
</template>
