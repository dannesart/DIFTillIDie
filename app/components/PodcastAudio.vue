<script setup lang="ts">
import type { PodcastsResponse } from '#shared/types/domain'

/* The page's one and only <audio> element. Every show and the mini-player drive it. */
const audio = useTemplateRef<HTMLAudioElement>('audio')
const { attach, detach, restore } = usePodcastPlayer()
// The shows the page already fetched (never a fetch of its own).
const { data: podcasts } = useNuxtData<PodcastsResponse>('podcasts')
onMounted(() => audio.value && attach(audio.value))
// The last episode, paused where it was: once every part of the page has
// hydrated as the server rendered it, so nothing it changes can mismatch.
onNuxtReady(() => restore(podcasts.value?.shows))
onBeforeUnmount(() => audio.value && detach(audio.value))
</script>

<template>
  <audio ref="audio" preload="none" />
</template>
