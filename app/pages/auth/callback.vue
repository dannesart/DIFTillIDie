<script setup lang="ts">
/*
 * Google sends supporters back here. We finish the PKCE exchange in the
 * browser (this route is never server-rendered or cached), then return them
 * to where they started — opening the profile step if they're new.
 */
useHead({ title: 'Loggar in… – Djurgår’n tills jag dör', meta: [{ name: 'robots', content: 'noindex' }] })

const auth = useAuth()
const accountOpen = useAccountDialog()
const failure = ref<string | null>(null)
const retrying = ref(false)

onMounted(async () => {
  const result = await auth.handleCallback(window.location.href)
  if (!result.ok) {
    failure.value = result.message
    // Don't leave the one-time code in the address bar or history.
    history.replaceState(history.state, '', '/auth/callback')
    return
  }
  if (result.needsProfile) accountOpen.value = true
  await navigateTo(result.returnTo, { replace: true })
})

async function retry() {
  retrying.value = true
  if (!(await auth.signInWithGoogle('/'))) {
    retrying.value = false
    failure.value = auth.error.value ?? failure.value
  }
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center px-6 py-16 text-center">
    <div class="max-w-sm">
      <div class="stripes mx-auto h-16 w-12 rounded-xl [--stripe:8px]" :class="!failure && 'motion-safe:animate-pulse'" aria-hidden="true" />
      <template v-if="!failure">
        <h1 class="mt-7 font-display text-3xl font-bold">Loggar in<span class="text-himmel">…</span></h1>
        <p class="mt-2 text-sm text-krita-dim" aria-live="polite">Ett ögonblick, vi släpper in dig på läktaren.</p>
      </template>
      <template v-else>
        <h1 class="mt-7 font-display text-3xl font-bold">Det gick inte riktigt</h1>
        <p class="mt-3 text-sm leading-relaxed text-krita-dim" role="alert">{{ failure }}</p>
        <div class="mt-7 flex flex-wrap justify-center gap-2">
          <button class="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#1f1f1f] disabled:opacity-60" :disabled="retrying" @click="retry">
            {{ retrying ? 'Skickar dig till Google…' : 'Försök igen' }}
          </button>
          <NuxtLink to="/" class="rounded-full border border-white/15 px-5 py-3 text-sm font-bold hover:border-himmel hover:text-himmel">Till startsidan</NuxtLink>
        </div>
      </template>
    </div>
  </main>
</template>
