<script setup lang="ts">
import { difpodden } from '~/data/media'

/*
 * DIFpodden lives on Patreon. Same anatomy as the playable show cards —
 * cover, kicker, title, links — but no play button: listening happens at
 * Patreon, and we say so plainly. See data/media.ts for what was verified.
 */
const why = ref(false)
</script>

<template>
  <article class="card group relative overflow-hidden">
    <div class="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      <MediaCover cover="stripes" title="DIFpodden" kind="podd" class="aspect-[16/9] lg:aspect-auto" />

      <div class="min-w-0 p-5 sm:p-7">
        <div class="flex flex-wrap items-center gap-2">
          <span class="kicker text-krita-dim">Podcast</span>
          <span class="kicker inline-flex items-center gap-1.5 rounded-full bg-guld/15 px-2 py-0.5 text-guld">
            <svg viewBox="0 0 24 24" class="size-3" fill="currentColor" aria-hidden="true"><circle cx="15" cy="9.5" r="6.5" /><rect x="3" y="3" width="3.5" height="18" rx="1" /></svg>
            Lyssnas hos Patreon
          </span>
        </div>
        <h4 class="mt-2 font-display text-3xl font-semibold leading-tight">
          <a :href="difpodden.patreon" target="_blank" rel="noopener" class="decoration-himmel/60 underline-offset-4 hover:underline">{{ difpodden.title }}</a>
        </h4>
        <p class="mt-2 max-w-2xl leading-relaxed text-krita-dim">{{ difpodden.pitch }}</p>

        <div class="mt-5 flex flex-wrap gap-1.5" aria-label="Format i medlemsnivåerna">
          <span v-for="f in difpodden.formats" :key="f" class="rounded-full border border-white/10 px-2.5 py-1 text-xs text-krita">{{ f }}</span>
        </div>
        <p class="mt-2 text-xs text-krita-dim">
          Ingår i poddens medlemsnivåer.<template v-if="difpodden.freeMembership"> Det finns också ett gratis medlemskap.</template>
        </p>

        <div class="mt-6 flex flex-wrap items-center gap-2">
          <a
            :href="difpodden.patreon"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-2 rounded-full bg-guld px-5 py-2.5 text-sm font-bold text-navy-950 shadow-[0_10px_30px_-12px_rgb(244_196_48/0.8)] transition hover:-translate-y-0.5"
          >
            Lyssna hos Patreon <span aria-hidden="true">↗</span>
          </a>
          <a :href="difpodden.spotify.url" target="_blank" rel="noopener" class="chip border-white/12 hover:border-himmel hover:text-himmel">{{ difpodden.spotify.label }} ↗</a>
          <a :href="difpodden.archive.url" target="_blank" rel="noopener" class="chip border-white/12 text-krita-dim hover:border-himmel hover:text-himmel">{{ difpodden.archive.label }} ↗</a>
        </div>

        <!-- Honest about why there's no play button -->
        <button class="mt-5 text-xs font-semibold text-krita-dim underline decoration-white/20 underline-offset-2 hover:text-krita" :aria-expanded="why" aria-controls="difpodden-why" @click="why = !why">
          Varför spelas DIFpodden inte här?
        </button>
        <p v-if="why" id="difpodden-why" class="mt-2 max-w-2xl text-xs leading-relaxed text-krita-dim">
          DIFpodden har slagit på Patreons öppna podcastflöde, men adressen till det finns inte publicerad någonstans vi kan kontrollera.
          Medlemsavsnitten hör hemma bakom Patreons betalvägg, och den går vi aldrig runt. Delar podden sin öppna flödesadress spelar vi de öppna avsnitten här direkt.
        </p>
      </div>
    </div>
  </article>
</template>
