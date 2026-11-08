<script setup lang="ts">
import type { EpisodeProgress } from '~/lib/listeningHistory'
import { progressLabel } from '~/lib/listeningHistory'

/*
 * An episode's own listening progress, quietly: a thin bar and roughly how
 * much is left, or "Lyssnad" once really listened to the end. Nothing for an
 * episode that hasn't been started (see lib/listeningHistory).
 */
const props = defineProps<{ progress: EpisodeProgress }>()
const label = computed(() => progressLabel(props.progress))
</script>

<template>
  <span v-if="label" class="mt-1 flex items-center gap-2 text-xs" :class="progress.state === 'completed' ? 'text-himmel' : 'text-krita-dim'">
    <svg v-if="progress.state === 'completed'" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
    <span v-else-if="progress.state === 'progress' && progress.remaining !== null" class="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <span class="block h-full rounded-full bg-guld" :style="{ width: `${Math.max(6, progress.fraction * 100)}%` }" />
    </span>
    <span>{{ label }}</span>
  </span>
</template>
