<script setup lang="ts">
const open = ref(false)
</script>

<template>
  <div class="relative z-50 bg-guld text-navy-950">
    <div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-1.5 text-xs font-semibold sm:px-6">
      <span class="kicker rounded-full bg-navy-950 px-2 py-0.5 text-guld">Demo</span>
      <p class="min-w-0 flex-1 truncate">
        Allt innehåll här är påhittat – källor, inlägg och matcher – medan vi utforskar upplevelsen.
      </p>
      <button class="shrink-0 underline decoration-2 underline-offset-2" :aria-expanded="open" @click="open = !open">
        {{ open ? 'Stäng' : 'Vad betyder det?' }}
      </button>
    </div>
    <div v-if="open" class="mx-auto max-w-7xl px-4 pb-3 text-sm sm:px-6">
      Nyhetskällorna (Kvällsekot, Östra Sport m.fl.) är fiktiva och deras länkar går till example.com.
      Personerna i Snacket finns inte. Det du själv skriver, reagerar och kommenterar sparas bara i din webbläsare.
      Poddar och videokanaler länkar till riktiga sökningar hos Spotify, Apple Podcasts och YouTube.
    </div>
  </div>
</template>
