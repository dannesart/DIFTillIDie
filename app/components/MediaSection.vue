<script setup lang="ts">
import { media } from '~/data/media'

const demoNow = useDemoNow()
const now = useNow(60_000)
const night = computed(() => dayPart(now.value ?? demoNow.value) === 'natt')

const pods = computed(() => {
  const list = media.filter(m => m.kind === 'podd')
  return night.value ? [...list].sort((a, b) => Number(!!b.nocturnal) - Number(!!a.nocturnal)) : list
})
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
        Vi har inte kopplat in några officiella flöden än. Länkarna öppnar riktiga sökningar hos Spotify, Apple Podcasts och YouTube.
        Ingen falsk play-knapp här.
      </p>
    </div>

    <div class="mt-10 grid gap-5 md:grid-cols-2">
      <MediaCard v-for="m in pods" :key="m.id" :item="m" :highlight="night && m.nocturnal" large />
    </div>

    <h3 class="kicker mt-14 text-krita-dim">Videokanaler</h3>
    <div class="mt-4 grid gap-5 sm:grid-cols-2">
      <MediaCard v-for="m in videos" :key="m.id" :item="m" />
    </div>
  </section>
</template>
