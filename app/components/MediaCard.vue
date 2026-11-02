<script setup lang="ts">
import type { MediaItem } from '~/data/media'

const props = defineProps<{ item: MediaItem, large?: boolean, highlight?: boolean }>()

/* Click-to-load: nothing from Spotify/YouTube is fetched until asked for. */
const playing = ref(false)
const isSpotify = computed(() => props.item.embed?.includes('spotify.com'))
</script>

<template>
  <article class="card group relative flex overflow-hidden transition duration-500 hover:-translate-y-1 hover:border-white/15" :class="large ? 'flex-col sm:flex-row' : 'flex-row items-stretch'">
    <MediaCover :cover="item.cover" :title="item.title" :kind="item.kind" :class="large ? 'aspect-square sm:w-56 sm:shrink-0' : 'w-28 shrink-0 sm:w-36'" />

    <div class="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
      <div class="flex items-center gap-2">
        <span class="kicker text-krita-dim">{{ item.kind === 'podd' ? 'Podcast' : 'YouTube' }}</span>
        <span v-if="highlight" class="kicker rounded-full bg-guld/15 px-2 py-0.5 text-guld">🌙 Perfekt läge just nu</span>
      </div>
      <h4 class="mt-2 font-display font-semibold leading-tight" :class="large ? 'text-3xl' : 'text-xl'">{{ item.title }}</h4>
      <p class="mt-2 text-sm leading-relaxed text-krita-dim" :class="!large && 'line-clamp-2'">{{ item.tagline }}</p>

      <div v-if="item.embed" class="mt-4">
        <iframe
          v-if="playing"
          :src="item.embed"
          :title="item.title"
          class="w-full rounded-xl border-0"
          :class="isSpotify ? 'h-[152px]' : 'aspect-video'"
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowfullscreen
        />
        <button v-else class="rounded-full bg-himmel px-4 py-2 text-sm font-bold text-navy-950" @click="playing = true">
          Ladda spelaren
        </button>
      </div>

      <div class="mt-auto flex flex-wrap gap-2 pt-5">
        <a
          v-for="l in item.links"
          :key="l.url"
          :href="l.url"
          target="_blank"
          rel="noopener"
          class="chip border-white/12 hover:border-himmel hover:text-himmel"
        >
          {{ l.label }} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  </article>
</template>
