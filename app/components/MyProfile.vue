<script setup lang="ts">
/*
 * "Din profil" on the settings page: the one profile form (ProfileForm),
 * inline, for editing your existing profile. Creating one (a new supporter)
 * stays in the account dialog. Shown only when you're signed in with a
 * profile (shell/views/Installningar.vue decides).
 *
 * Saving goes through the auth store as before, so your name, handle, avatar
 * and bio update everywhere at once: the sidebar, the account menu, your
 * läktarplats. After a save the form starts again from what was saved
 * (e.g. a handle as the database normalised it).
 */
const { profile } = useAuth()
const links = useSectionLinks()

const version = ref(0)
const saved = ref(false)
let hide: ReturnType<typeof setTimeout> | undefined

function onSaved() {
  version.value++
  saved.value = true
  clearTimeout(hide)
  hide = setTimeout(() => (saved.value = false), 4000)
}
onBeforeUnmount(() => clearTimeout(hide))
</script>

<template>
  <section v-if="profile" id="din-profil" class="card p-5 sm:p-6" aria-labelledby="my-profile">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="my-profile" class="font-display text-2xl font-bold">Din profil</h2>
      <NuxtLink :to="links.supporter(profile.handle)" class="text-xs font-semibold text-himmel hover:underline">Visa din läktarplats →</NuxtLink>
    </div>
    <p class="mt-1 text-sm leading-relaxed text-krita-dim">
      Så syns du i Snacket på stan. Namn, handle, avatar och text om dig syns för alla när du har skrivit något – din e-postadress aldrig.
    </p>
    <ProfileForm :key="version" class="mt-5" :initial="profile" inline @saved="onSaved" />
    <p class="mt-3 min-h-5 text-sm font-semibold text-himmel" role="status" aria-live="polite">
      <template v-if="saved">✓ Profilen är sparad.</template>
    </p>
  </section>
</template>
