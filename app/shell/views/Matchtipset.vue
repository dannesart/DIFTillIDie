<script setup lang="ts">
/*
 * Shell view: Matchtipset (components/MatchtipsetPage.vue). Until its launch
 * gate is on, the address doesn't exist: a 404, from the server and in the
 * browser alike, so an unlinked URL isn't a way in through the UI. (The
 * database functions are what they are; see docs/matchtipset.md.)
 */
if (!useMatchtipsetEnabled().value) {
  throw createError({ statusCode: 404, statusMessage: 'Sidan finns inte', fatal: true })
}
useHead({ title: 'Matchtipset · Djurgår’n tills jag dör' })
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:px-6 lg:pt-10">
    <MatchtipsetPage />
  </div>
</template>
