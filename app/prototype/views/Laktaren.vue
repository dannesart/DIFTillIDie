<script setup lang="ts">
/*
 * Prototype view: a supporter's place on the stands, the same component as
 * /laktaren/<handle>. The shell keys its views by path, so another supporter
 * is always a fresh instance.
 */
const route = useRoute()
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:px-6 lg:pt-10">
    <SupporterPlace :address="String(route.params.handle)" />
  </div>
</template>
