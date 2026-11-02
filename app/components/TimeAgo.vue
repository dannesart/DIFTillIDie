<script setup lang="ts">
const props = defineProps<{ at: string }>()
const now = useNow(30_000)
// Server and first client render show a stable clock time; relative once mounted.
const label = computed(() => (now.value ? timeAgo(props.at, now.value) : `kl ${clockTime(props.at)}`))
</script>

<template>
  <time :datetime="at" :title="new Date(at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })">{{ label }}</time>
</template>
