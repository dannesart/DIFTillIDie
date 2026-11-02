<script setup lang="ts">
const open = ref(false)
</script>

<template>
  <div class="relative z-50 bg-guld text-navy-950">
    <!-- Wraps to two short lines on phones instead of cutting the message off -->
    <div class="mx-auto flex max-w-7xl items-start gap-2.5 px-4 py-2 text-[0.75rem] font-semibold leading-snug sm:items-center sm:gap-3 sm:px-6 sm:py-1.5 sm:text-xs">
      <span class="kicker mt-px shrink-0 rounded-full bg-navy-950 px-2 py-0.5 text-guld sm:mt-0">Delvis demo</span>
      <p class="min-w-0 flex-1">
        <span class="sm:hidden">Nyheter, poddar och matcher är riktiga. <span class="whitespace-nowrap">Snacket är påhittat.</span></span>
        <span class="hidden sm:inline">Nyheter, poddar och matcher är riktiga. Snacket på stan är påhittat.</span>
      </p>
      <button class="shrink-0 underline decoration-2 underline-offset-2" :aria-expanded="open" aria-controls="demo-details" @click="open = !open">
        <template v-if="open">Stäng</template>
        <template v-else><span class="sm:hidden">Mer</span><span class="hidden sm:inline">Vad betyder det?</span></template>
      </button>
    </div>
    <div v-if="open" id="demo-details" class="mx-auto max-w-7xl px-4 pb-3 text-sm sm:px-6">
      <strong>Riktigt:</strong> Stories hämtas från Bollsvenskans och Sportbladets egna RSS-flöden, med källornas rubriker och länkar.
      Avsnitten av Djurgårn by night och Blårandigt Snack kommer från poddarnas egna flöden; DIFpodden länkar vi till hos Patreon.
      Nästa match kommer från Djurgårdens officiella matchkalender på dif.se (fotboll) och från difhockey.se, kontrollerad för hand (hockey).
      <strong>Påhittat:</strong> personerna och inläggen i Snacket på stan.
      Det du själv skriver, reagerar och kommenterar sparas bara i din webbläsare.
      Sajten är tills vidare undantagen från sökmotorer.
    </div>
  </div>
</template>
