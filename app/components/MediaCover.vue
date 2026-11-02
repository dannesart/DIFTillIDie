<script setup lang="ts">
import type { MediaItem } from '~/data/media'

/* Generated cover art. Typography and shapes only — no borrowed artwork. */
defineProps<{ cover: MediaItem['cover'], title: string, kind: MediaItem['kind'] }>()
</script>

<template>
  <div class="relative isolate overflow-hidden" aria-hidden="true">
    <!-- Stripes -->
    <template v-if="cover === 'stripes'">
      <div class="stripes absolute inset-0 [--stripe:22px] transition-transform duration-[1.2s] ease-out-expo group-hover:scale-110" />
      <div class="absolute inset-0 bg-gradient-to-t from-navy-950/90 via-navy-950/20 to-transparent" />
      <div class="absolute inset-x-0 bottom-0 p-4">
        <span class="block font-display text-4xl font-black italic leading-none text-krita sm:text-5xl">DIF</span>
        <span class="kicker text-himmel-200">podden</span>
      </div>
    </template>

    <!-- Night -->
    <template v-else-if="cover === 'night'">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,#1b3c7c_0%,#0a1b3d_45%,#030915_100%)]" />
      <span v-for="i in 18" :key="i" class="absolute size-[2px] rounded-full bg-white" :style="{ left: `${(i * 41) % 95}%`, top: `${(i * 29) % 60}%`, animation: `twinkle ${2 + (i % 4)}s ease-in-out ${i % 3}s infinite` }" />
      <div class="absolute right-[18%] top-[16%] size-14 rounded-full bg-guld shadow-[0_0_50px_10px_rgb(244_196_48/0.35)] transition-transform duration-1000 group-hover:-translate-y-2">
        <div class="absolute -left-2 -top-1 size-14 rounded-full bg-[#0f2550]" />
      </div>
      <div class="absolute inset-x-0 bottom-0 p-4">
        <span class="block font-display text-2xl font-bold italic leading-none text-krita sm:text-3xl">by Night</span>
        <span class="kicker text-himmel-300">Djurgår’n</span>
      </div>
    </template>

    <!-- Grass: pitch lines -->
    <template v-else-if="cover === 'grass'">
      <div class="absolute inset-0 bg-[repeating-linear-gradient(0deg,#0f2a55_0_18px,#123063_18px_36px)]" />
      <svg viewBox="0 0 100 100" class="absolute inset-0 size-full text-himmel/50 transition-transform duration-1000 group-hover:scale-105" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="8" y="8" width="84" height="84" /><line x1="8" y1="50" x2="92" y2="50" /><circle cx="50" cy="50" r="13" /><rect x="30" y="8" width="40" height="16" /><rect x="30" y="76" width="40" height="16" />
      </svg>
    </template>

    <!-- Ice: rink -->
    <template v-else>
      <div class="absolute inset-0 bg-[linear-gradient(160deg,#dff0fc,#9bd0f5)]" />
      <svg viewBox="0 0 100 100" class="absolute inset-0 size-full transition-transform duration-1000 group-hover:rotate-3" fill="none" stroke-width="1.6">
        <line x1="0" y1="50" x2="100" y2="50" stroke="#e03a3e" /><line x1="0" y1="30" x2="100" y2="30" stroke="#2a55a3" /><line x1="0" y1="70" x2="100" y2="70" stroke="#2a55a3" />
        <circle cx="50" cy="50" r="12" stroke="#2a55a3" /><circle cx="50" cy="50" r="2" fill="#2a55a3" stroke="none" />
      </svg>
    </template>
  </div>
</template>
