<script setup lang="ts">
import { media } from '~/data/media'

const demoNow = useDemoNow()
const now = useNow(60_000)
const night = computed(() => dayPart(now.value ?? demoNow.value) === 'natt')

const { data } = usePodcasts()
const shows = computed(() => data.value?.shows ?? [])
const { selectedShow } = usePodcastPlayer()

// Until someone picks: the night show after dark, otherwise the freshest episode.
const defaultShow = computed(() => {
  const list = shows.value
  if (night.value) {
    const nocturnal = list.find(s => s.nocturnal && s.episodes.length)
    if (nocturnal) return nocturnal.id
  }
  return [...list].sort((a, b) => (b.episodes[0]?.publishedAt ?? '').localeCompare(a.episodes[0]?.publishedAt ?? ''))[0]?.id ?? ''
})
const active = computed({
  get: () => selectedShow.value ?? defaultShow.value,
  set: (id: string) => (selectedShow.value = id),
})
const activeShow = computed(() => shows.value.find(s => s.id === active.value))
const liveCount = computed(() => shows.value.filter(s => s.episodes.length).length)

const pods = media.filter(m => m.kind === 'podd')
const videos = media.filter(m => m.kind === 'video')
</script>

<template>
  <section id="lyssna" class="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
    <div class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <p class="kicker text-himmel">Poddar & video</p>
        <h2 class="section-title mt-3">Lyssna <span class="italic font-normal text-krita-dim">&</span> titta</h2>
      </div>
      <p class="max-w-sm text-sm leading-relaxed text-krita-dim">
        <template v-if="liveCount">Blårandiga poddar som spelas direkt här, från sina egna flöden.</template>
        <template v-else>Vi når inte poddarnas flöden just nu – men länkarna nedan fungerar.</template>
        Övriga poddar och kanaler länkar till riktiga sökningar hos Spotify, Apple Podcasts och YouTube – ingen falsk play-knapp.
      </p>
    </div>

    <template v-if="shows.length">
      <PodcastPicker v-model="active" :shows="shows" :night="night" class="mt-10" />
      <Transition mode="out-in" enter-from-class="opacity-0 motion-safe:translate-y-2" leave-to-class="opacity-0" enter-active-class="transition duration-300" leave-active-class="transition duration-150">
        <PodcastShow
          v-if="activeShow"
          :id="`panel-${activeShow.id}`"
          :key="activeShow.id"
          role="tabpanel"
          :aria-labelledby="`tab-${activeShow.id}`"
          :podcast="activeShow"
          :highlight="night && activeShow.nocturnal"
          class="mt-4"
        />
      </Transition>
    </template>

    <div class="mt-5 grid gap-5">
      <MediaCard v-for="m in pods" :key="m.id" :item="m" />
    </div>

    <h3 class="kicker mt-14 text-krita-dim">Videokanaler</h3>
    <div class="mt-4 grid gap-5 sm:grid-cols-2">
      <MediaCard v-for="m in videos" :key="m.id" :item="m" />
    </div>
  </section>
</template>
