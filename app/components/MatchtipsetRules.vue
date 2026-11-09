<script setup lang="ts">
import { ref, useId } from 'vue'
import { SIXTY_MINUTES } from '~/lib/matchtips'

/*
 * How Matchtipset counts: the scoring in one line, always; the details (the
 * 60-minute rule, the deadline) on a phone only when asked for, so the
 * matches come first. From lg up the details are simply shown, compactly.
 * A real <button> with aria-expanded: Enter and Space work, and the state is
 * announced.
 */
const open = ref(false)
const details = useId()
</script>

<template>
  <section class="card p-5 sm:p-6" aria-labelledby="mt-rules">
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h2 id="mt-rules" class="font-display text-xl font-bold">Så räknas det</h2>
      <!-- The scoring, always -->
      <ul class="flex flex-wrap gap-2 text-sm" aria-label="Poäng">
        <li class="rounded-full bg-white/[0.06] px-3 py-1"><strong class="text-himmel">3 p</strong> exakt</li>
        <li class="rounded-full bg-white/[0.06] px-3 py-1"><strong class="text-himmel">1 p</strong> rätt utgång</li>
        <li class="rounded-full bg-white/[0.06] px-3 py-1"><strong class="text-himmel">0 p</strong> annars</li>
      </ul>
    </div>
    <button
      type="button"
      class="mt-3 flex items-center gap-1.5 text-sm font-semibold text-himmel underline-offset-4 hover:underline lg:hidden"
      :aria-expanded="open"
      :aria-controls="details"
      @click="open = !open"
    >
      {{ open ? 'Dölj reglerna' : 'Läs hur det räknas' }}
      <svg viewBox="0 0 24 24" class="size-4 transition-transform" :class="open && 'rotate-180'" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div :id="details" class="mt-3 max-w-prose space-y-2 text-sm lg:block" :class="open ? 'block' : 'hidden'">
      <p class="font-semibold text-guld">{{ SIXTY_MINUTES }}</p>
      <p class="text-krita-dim">3 poäng för exakt resultat, 1 poäng för rätt utgång (hemmaseger, oavgjort eller bortaseger), annars 0.</p>
      <p class="text-krita-dim">Du kan ändra ditt tips fram till matchens deadline, som är nedsläppet. Fram till dess ser bara du ditt tips.</p>
    </div>
  </section>
</template>
