<script setup lang="ts">
import { TEAM_INTERESTS } from '#shared/utils/profile'

/*
 * "Mina lag": the signed-in supporter's private team interests. Nobody else
 * can read them, and nothing is hidden because of them. Shown on your
 * settings page (/installningar, shell/views/Installningar.vue), which shows
 * it only once you're signed in with a profile. Until Following's sidebar
 * iteration it was on your own läktarplats; same data, same behaviour.
 */
const auth = useAuth()
const preferences = usePreferences()

// Loaded once you're signed in with a profile (and again for whoever signs in next).
watch([auth.userId, () => auth.profileStatus.value], ([uid, ps]) => {
  if (uid && ps === 'ready' && preferences.status.value === 'idle') void preferences.load()
}, { immediate: true })
</script>

<template>
  <section class="card p-5 sm:p-6" aria-labelledby="my-teams">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="my-teams" class="font-display text-2xl font-bold">Mina lag</h2>
      <span class="text-xs font-semibold text-krita-dim">🔒 Bara för dig</span>
    </div>
    <p class="mt-1 text-sm leading-relaxed text-krita-dim">
      Vilka Djurgården följer du? Ingen annan ser ditt val, och vi gömmer aldrig något i flödet för att du gjort det.
    </p>
    <p v-if="preferences.status.value === 'unavailable'" class="mt-4 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-krita-dim">
      Mina lag går inte att använda här än – databasen har inte stöd för det ännu.
    </p>
    <p v-else-if="preferences.status.value === 'error'" class="mt-4 text-sm text-krita-dim" role="alert">
      Kunde inte hämta dina lag.
      <button class="font-semibold text-himmel hover:underline" @click="preferences.load()">Försök igen</button>
    </p>
    <div v-else class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" :aria-busy="preferences.status.value !== 'ready' || preferences.saving.value">
      <button
        v-for="t in TEAM_INTERESTS"
        :key="t.key"
        type="button"
        :aria-pressed="preferences.teams.value.includes(t.key)"
        :disabled="preferences.status.value !== 'ready' || preferences.saving.value"
        class="group flex flex-col items-start rounded-2xl border px-4 py-3 text-left transition disabled:cursor-wait motion-safe:enabled:hover:-translate-y-0.5"
        :class="preferences.teams.value.includes(t.key) ? 'border-himmel bg-himmel/12' : 'border-white/10 hover:border-white/25'"
        @click="preferences.toggle(t.key)"
      >
        <span class="text-lg" aria-hidden="true">{{ t.sport === 'Fotboll' ? '⚽' : '🏒' }}</span>
        <span class="mt-1 font-display text-lg font-bold leading-tight">{{ t.sport }}</span>
        <span class="text-sm text-krita-dim">{{ t.team }}</span>
        <span class="mt-2 text-xs font-bold" :class="preferences.teams.value.includes(t.key) ? 'text-himmel' : 'text-krita-dim'">
          {{ preferences.teams.value.includes(t.key) ? '✓ Följer' : 'Följ' }}
        </span>
      </button>
    </div>
    <p v-if="preferences.error.value" class="mt-3 text-sm font-semibold text-rod" role="alert">{{ preferences.error.value }}</p>
  </section>
</template>
