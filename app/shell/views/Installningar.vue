<script setup lang="ts">
/*
 * Shell view: your own settings, at /installningar: "Din profil"
 * (components/MyProfile.vue: name, handle, avatar and bio, the one profile
 * form, inline) and "Mina lag" (components/MyTeams.vue, your private team
 * interests). Choosing your name the first time stays in the account dialog,
 * so a new supporter's journey is unchanged.
 *
 * Everything personal is in the browser: the server (and its cache) only
 * ever renders the neutral "loading" state, like every other personal part.
 */
const auth = useAuth()
const { status, profileStatus } = auth
const accountOpen = useAccountDialog()

useSeoMeta({
  title: 'Inställningar – Djurgår’n tills jag dör',
  robots: 'noindex, nofollow',
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:px-6 lg:max-w-240 lg:pt-10">
    <p class="kicker text-himmel">Ditt konto</p>
    <h1 class="mt-1 font-display text-4xl font-bold leading-none tracking-tight sm:text-5xl">Inställningar</h1>

    <!-- Signed in with a profile: your settings -->
    <div v-if="status === 'signed-in' && profileStatus === 'ready'" class="mt-6 space-y-5">
      <MyProfile />
      <MyTeams />
    </div>

    <!-- Signed in, no name chosen yet: that's the account dialog's onboarding, as before -->
    <section v-else-if="status === 'signed-in' && profileStatus === 'missing'" class="card mt-6 px-6 py-8">
      <p class="text-krita-dim">Välj ditt läktarnamn först, så kan du sköta din profil och välja vilka lag du följer.</p>
      <button class="mt-4 rounded-full bg-guld px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" @click="accountOpen = true">Välj läktarnamn</button>
    </section>

    <section v-else-if="status === 'signed-in' && profileStatus === 'error'" class="card mt-6 px-6 py-8" role="alert">
      <p class="text-krita-dim">Vi kunde inte hämta din profil just nu.</p>
      <button class="mt-4 rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold transition hover:border-himmel hover:text-himmel" @click="auth.loadProfile()">Försök igen</button>
    </section>

    <!-- Signed out: your settings are yours, so nothing to show until you're in -->
    <section v-else-if="status === 'signed-out'" class="card mt-6 px-6 py-8">
      <p class="text-krita-dim">Logga in för att se dina inställningar.</p>
      <button class="mt-4 rounded-full bg-guld px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" aria-haspopup="dialog" @click="accountOpen = true">Logga in</button>
    </section>

    <section v-else-if="status === 'unavailable'" class="card mt-6 px-6 py-8">
      <p class="text-krita-dim">Inloggning är inte påslagen här ännu, så det finns inga inställningar att göra.</p>
    </section>

    <!-- Still checking for a session (and what the server renders) -->
    <div v-else class="card mt-6 h-40 animate-pulse" aria-busy="true">
      <span class="sr-only">Hämtar dina inställningar…</span>
    </div>
  </div>
</template>
