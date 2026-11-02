<script setup lang="ts">
/*
 * The account entry point in the desktop header (phones use the bottom nav).
 * Neutral until the browser has checked for a session, so server and client
 * markup always match.
 */
const { status, profile, profileStatus } = useAuth()
const open = useAccountDialog()

const label = computed(() => {
  if (status.value !== 'signed-in') return 'Logga in'
  if (profileStatus.value === 'missing') return 'Konto: slutför din profil'
  return profile.value ? `Konto: ${profile.value.displayName}` : 'Konto'
})
</script>

<template>
  <button
    v-if="status !== 'unavailable'"
    class="size-10 shrink-0 place-items-center rounded-full border border-white/12 bg-navy-900/80 transition hover:border-himmel/60"
    :aria-label="label"
    :title="label"
    aria-haspopup="dialog"
    @click="open = true"
  >
    <AccountGlyph />
  </button>
</template>
