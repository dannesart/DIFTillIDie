<script setup lang="ts">
/*
 * Shell view: a supporter's place on the stands (components/SupporterPlace.vue).
 * The shell keys its views by path, so another supporter is always a fresh
 * instance: the address, identity, posts and "is this mine" are never carried over.
 */
const route = useRoute()
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:px-6 lg:pt-10">
    <SupporterPlace :address="String(route.params.handle)" />
  </div>
</template>
