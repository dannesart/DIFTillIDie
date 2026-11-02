<script setup lang="ts">
const open = ref(false)
</script>

<template>
  <div class="relative z-50 bg-guld text-navy-950">
    <div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-1.5 text-xs font-semibold sm:px-6">
      <span class="kicker rounded-full bg-navy-950 px-2 py-0.5 text-guld">Delvis demo</span>
      <p class="min-w-0 flex-1 truncate">
        Nyheter och poddavsnitt är riktiga. Snacket på stan och nästa match är påhittade.
      </p>
      <button class="shrink-0 underline decoration-2 underline-offset-2" :aria-expanded="open" @click="open = !open">
        {{ open ? 'Stäng' : 'Vad betyder det?' }}
      </button>
    </div>
    <div v-if="open" class="mx-auto max-w-7xl px-4 pb-3 text-sm sm:px-6">
      <strong>Riktigt:</strong> Stories hämtas från Bollsvenskans och Sportbladets egna RSS-flöden, med källornas rubriker och länkar.
      Avsnitten av Djurgårn by night kommer från poddens eget flöde.
      <strong>Påhittat:</strong> personerna och inläggen i Snacket på stan, och nästa match med nedräkning.
      Det du själv skriver, reagerar och kommenterar sparas bara i din webbläsare.
      Sajten är tills vidare undantagen från sökmotorer.
    </div>
  </div>
</template>
