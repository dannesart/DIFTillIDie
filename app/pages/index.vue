<script setup lang="ts">
const { load } = useSnacket()
onMounted(load)
</script>

<template>
  <div class="relative min-h-dvh overflow-x-clip">
    <DemoBanner />
    <AppHeader />
    <main>
      <HeroMatchday />
      <SnackTicker />
      <StorySection />
      <SnacketSection />
      <MediaSection />
    </main>
    <AppFooter />
    <StripeBurst />
  </div>
</template>
