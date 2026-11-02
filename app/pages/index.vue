<script setup lang="ts">
const { load } = useSnacket()
onMounted(load)

// Fetch real content during SSR; sections read the same data by key.
await Promise.all([useNews(), usePodcast()])
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
    <MiniPlayer />
    <StripeBurst />
  </div>
</template>
