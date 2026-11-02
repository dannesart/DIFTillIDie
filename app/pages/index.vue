<script setup lang="ts">
const { load } = useSnacket()
const { load: loadDrafts } = useStoryCompose()
onMounted(() => {
  load()
  loadDrafts()
})

// Fetch real content during SSR; sections read the same data by key.
await Promise.all([useNews(), usePodcasts(), useFixtures()])
</script>

<template>
  <div class="relative min-h-dvh overflow-x-clip">
    <DemoBanner />
    <AppHeader />
    <main>
      <HeroMatchday />
      <StorySection />
      <SnacketSection />
      <MediaSection />
    </main>
    <AppFooter />
    <PodcastAudio />
    <MiniPlayer />
    <StoryComposeDialog />
    <MobileNav />
    <InstallHint />
    <InstallGuide />
    <AccountDialog />
    <StripeBurst />
  </div>
</template>
