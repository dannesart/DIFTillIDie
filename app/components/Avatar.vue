<script setup lang="ts">
import type { AvatarKey } from '#shared/utils/profile'

/*
 * A supporter's avatar. By default their own stripes with their initials
 * (derived from the name); or one of the designs they can choose
 * (shared/utils/profile.ts AVATARS). Drawn here: no images, no club marks.
 */
const props = defineProps<{ name: string, design?: AvatarKey | null, size?: 'sm' | 'md' | 'lg' | 'xl' }>()

const seed = computed(() => [...props.name].reduce((a, c) => a + c.charCodeAt(0), 0))
const striped = computed(() => ({
  background: `repeating-linear-gradient(${(seed.value % 4) * 45}deg, var(--color-navy-700) 0 ${4 + (seed.value % 4)}px, var(--color-navy-800) ${4 + (seed.value % 4)}px ${8 + 2 * (seed.value % 4)}px)`,
}))

const BACKGROUNDS: Record<AvatarKey, string> = {
  himmel: 'repeating-linear-gradient(90deg, var(--color-himmel) 0 22%, var(--color-navy-800) 22% 33.3%)',
  tricolor: 'linear-gradient(180deg, var(--color-navy-700) 0 40%, var(--color-guld) 40% 62%, var(--color-rod) 62% 100%)',
  stjarna: 'radial-gradient(circle at 50% 40%, var(--color-navy-700), var(--color-navy-950) 75%)',
  halsduk: 'repeating-linear-gradient(135deg, var(--color-himmel) 0 9%, var(--color-navy-800) 9% 18%, var(--color-guld) 18% 22%, var(--color-navy-800) 22% 31%)',
  boll: 'radial-gradient(circle at 50% 35%, var(--color-navy-600), var(--color-navy-900) 80%)',
  puck: 'linear-gradient(180deg, var(--color-himmel-200) 0 55%, var(--color-himmel-300) 55%)',
  trumma: 'radial-gradient(circle at 50% 30%, var(--color-rod), #8f1d22 85%)',
}
/** Designs whose pattern carries the initials; the others are a drawing instead. */
const WITH_INITIALS: AvatarKey[] = ['himmel', 'tricolor', 'halsduk']

const style = computed(() => (props.design ? { background: BACKGROUNDS[props.design] } : striped.value))
const showInitials = computed(() => !props.design || WITH_INITIALS.includes(props.design))
const SIZES = { sm: 'size-8 text-xs', md: 'size-11 text-sm', lg: 'size-16 text-xl', xl: 'size-24 text-3xl sm:size-28' }
</script>

<template>
  <span
    class="relative grid shrink-0 place-items-center overflow-hidden rounded-full font-display font-bold text-krita ring-2 ring-himmel/30"
    :class="SIZES[size ?? 'md']"
    :style="style"
    aria-hidden="true"
  >
    <span v-if="showInitials" class="relative" :class="design && '[text-shadow:0_1px_3px_rgb(6_18_41/0.9)]'">{{ initials(name) }}</span>
    <svg v-else viewBox="0 0 40 40" class="size-[62%]" fill="none">
      <!-- Guldstjärna -->
      <path v-if="design === 'stjarna'" d="M20 4l4.7 10.1 11 1.2-8.2 7.5 2.3 10.9L20 28.2l-9.8 5.5 2.3-10.9-8.2-7.5 11-1.2z" fill="var(--color-guld)" stroke="#fff3c4" stroke-width="1.2" stroke-linejoin="round" />
      <!-- Boll -->
      <g v-else-if="design === 'boll'" stroke="var(--color-navy-950)" stroke-width="1.6" stroke-linejoin="round">
        <circle cx="20" cy="20" r="16" fill="var(--color-krita)" />
        <path d="M20 13l6.2 4.5-2.4 7.3h-7.6l-2.4-7.3z" fill="var(--color-navy-900)" />
        <path d="M20 13V4.5M26.2 17.5l8-2.6M23.8 24.8l5 6.8M16.2 24.8l-5 6.8M13.8 17.5l-8-2.6" />
      </g>
      <!-- Puck och klubbor -->
      <g v-else-if="design === 'puck'">
        <path d="M7 6l15 25M33 6L18 31" stroke="var(--color-navy-800)" stroke-width="3.2" stroke-linecap="round" />
        <path d="M17.5 30.5h-6M22.5 30.5h6" stroke="var(--color-navy-800)" stroke-width="3.2" stroke-linecap="round" />
        <ellipse cx="20" cy="34" rx="7.5" ry="3" fill="var(--color-navy-950)" />
      </g>
      <!-- Trumma -->
      <g v-else-if="design === 'trumma'" stroke="var(--color-krita)" stroke-width="1.6">
        <ellipse cx="20" cy="15" rx="12" ry="4.5" fill="var(--color-krita)" />
        <path d="M8 15v11c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5V15" fill="var(--color-navy-800)" />
        <path d="M8.5 17l6 12M16 19.5l5 11M24 19.5l-5 11M31.5 17l-6 12" stroke="var(--color-guld)" stroke-width="1.3" />
        <path d="M26 4l-5 9M32 6l-8 8" stroke="var(--color-guld)" stroke-width="2" stroke-linecap="round" />
      </g>
    </svg>
  </span>
</template>
