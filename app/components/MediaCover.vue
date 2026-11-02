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

    <!-- Snack: a speech bubble on blue stripes -->
    <template v-else-if="cover === 'snack'">
      <div class="absolute inset-0 bg-[repeating-linear-gradient(135deg,#5fb0ec_0_16px,#10295a_16px_32px)] transition-transform duration-[1.2s] ease-out-expo group-hover:scale-110" />
      <div class="absolute inset-0 bg-gradient-to-t from-navy-950/95 via-navy-950/40 to-navy-950/10" />
      <svg viewBox="0 0 120 100" class="absolute left-1/2 top-[38%] w-[46%] max-w-40 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_10px_24px_rgb(3_9_21/0.6)]">
        <path d="M14 10h92a10 10 0 0 1 10 10v44a10 10 0 0 1-10 10H50L28 92V74H14A10 10 0 0 1 4 64V20a10 10 0 0 1 10-10Z" fill="#f3eee3" />
        <circle cx="38" cy="42" r="6" fill="#10295a" /><circle cx="60" cy="42" r="6" fill="#10295a" /><circle cx="82" cy="42" r="6" fill="#f4c430" />
      </svg>
      <div class="absolute inset-x-0 bottom-0 p-4">
        <span class="block font-display text-2xl font-bold italic leading-none text-krita sm:text-3xl">Blårandigt</span>
        <span class="kicker text-himmel-200">Snack</span>
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
