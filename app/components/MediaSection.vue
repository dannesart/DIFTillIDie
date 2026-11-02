<script setup lang="ts">
import { media } from '~/data/media'

const demoNow = useDemoNow()
const now = useNow(60_000)
const night = computed(() => dayPart(now.value ?? demoNow.value) === 'natt')

const { data: podcast } = usePodcast()
// Real episodes when the feed works; otherwise the old card with search links.
const live = computed(() => !!podcast.value?.episodes.length)

const fallbackPods = computed(() => media.filter(m => m.kind === 'podd' && (!live.value || m.id !== 'by-night')))
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
        <template v-if="live">Djurgårn by night spelas direkt här, från poddens eget flöde.</template>
        <template v-else>Vi når inte poddflödet just nu.</template>
        Övriga poddar och kanaler länkar till riktiga sökningar hos Spotify, Apple Podcasts och YouTube – ingen falsk play-knapp.
      </p>
    </div>

    <PodcastShow v-if="live && podcast" :podcast="podcast" :highlight="night" class="mt-10" />

    <div class="mt-5 grid gap-5" :class="live ? 'md:grid-cols-1' : 'md:grid-cols-2'">
      <MediaCard v-for="m in fallbackPods" :key="m.id" :item="m" :highlight="night && m.nocturnal" :large="!live" />
    </div>

    <h3 class="kicker mt-14 text-krita-dim">Videokanaler</h3>
    <div class="mt-4 grid gap-5 sm:grid-cols-2">
      <MediaCard v-for="m in videos" :key="m.id" :item="m" />
    </div>
  </section>
</template>
