<script setup lang="ts">
/*
 * The shell's contextual sidebar: what's coming up while you read.
 * The next match (the hero's card), the newest real episodes, and what's
 * playing (the docked mini-player), all through the page's one <audio>
 * element like everywhere else. Optional: it only appears where the screen
 * has room for it (see AppShell.vue); below that the mini-player floats.
 */
defineProps<{ episodes?: boolean }>()
</script>

<template>
  <div class="space-y-6 px-5 py-6">
    <section aria-labelledby="rail-match">
      <h2 id="rail-match" class="sr-only">Nästa match</h2>
      <MatchCard />
    </section>

    <LatestEpisodes v-if="episodes" heading-id="rail-listen" />

    <!-- What's playing: only while an episode is chosen and its show's own player isn't in view; no space otherwise -->
    <MiniPlayer docked />
  </div>
</template>
