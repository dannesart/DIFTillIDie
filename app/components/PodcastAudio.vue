<script setup lang="ts">
/* The page's one and only <audio> element. Every show and the mini-player drive it. */
const audio = useTemplateRef<HTMLAudioElement>('audio')
const { attach, detach } = usePodcastPlayer()
onMounted(() => audio.value && attach(audio.value))
onBeforeUnmount(() => audio.value && detach(audio.value))
</script>

<template>
  <audio ref="audio" preload="none" />
</template>
