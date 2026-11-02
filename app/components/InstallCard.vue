<script setup lang="ts">
/* A quiet, always-available invitation in the footer. Hidden once installed. */
const { supported, canPrompt, guideOpen } = useInstall()
const mounted = ref(false)
onMounted(() => (mounted.value = true))
</script>

<template>
  <div v-if="mounted && supported" class="flex flex-wrap items-center gap-4 rounded-3xl border border-white/10 bg-navy-900/70 p-4 sm:p-5">
    <img src="/icons/icon-192.png" alt="" width="56" height="56" class="size-14 shrink-0 rounded-2xl shadow-[0_12px_30px_-12px_rgb(95_176_236/0.7)]">
    <div class="min-w-0 flex-1">
      <p class="font-display text-xl font-semibold">Djurgår’n i fickan</p>
      <p class="text-sm text-krita-dim">Lägg appen på hemskärmen – den öppnas direkt, utan adressfält.</p>
    </div>
    <button class="rounded-full bg-krita px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5 hover:bg-white" aria-haspopup="dialog" @click="guideOpen = true">
      {{ canPrompt ? 'Installera' : 'Visa hur' }}
    </button>
  </div>
</template>
