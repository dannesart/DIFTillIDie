<script setup lang="ts">
const props = defineProps<{ name: string, size?: 'sm' | 'md' }>()

// Every supporter gets their own stripes, derived from their name.
const seed = computed(() => [...props.name].reduce((a, c) => a + c.charCodeAt(0), 0))
const style = computed(() => ({
  background: `repeating-linear-gradient(${(seed.value % 4) * 45}deg, var(--color-navy-700) 0 ${4 + (seed.value % 4)}px, var(--color-navy-800) ${4 + (seed.value % 4)}px ${8 + 2 * (seed.value % 4)}px)`,
}))
</script>

<template>
  <span
    class="relative grid shrink-0 place-items-center rounded-full font-display font-bold text-krita ring-2 ring-himmel/30"
    :class="size === 'sm' ? 'size-8 text-xs' : 'size-11 text-sm'"
    :style="style"
    aria-hidden="true"
  >
    {{ initials(name) }}
  </span>
</template>
