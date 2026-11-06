<script setup lang="ts">
/*
 * A supporter's place on the stands (see components/SupporterPlace.vue): the
 * profile and wall, in the site's usual header, footer and mobile nav.
 */
/*
 * One supporter per page instance: going from one supporter's page to
 * another's (a name under a post, back/forward) builds a fresh page, so the
 * address, identity, posts, count and "is this mine" are never carried over.
 * Explicit, rather than relying on the router's default.
 */
definePageMeta({ key: r => `laktaren:${String(r.params.handle)}` })

const route = useRoute()
</script>

<template>
  <div class="relative min-h-dvh overflow-x-clip">
    <AppHeader />
    <main class="mx-auto max-w-3xl px-4 pb-16 pt-4 sm:px-6 sm:pt-8">
      <SupporterPlace :address="String(route.params.handle)" />
    </main>
    <AppFooter />
    <MobileNav />
  </div>
</template>
