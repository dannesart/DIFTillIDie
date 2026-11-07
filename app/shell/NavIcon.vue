<script setup lang="ts">
import type { SectionId } from '~/lib/sectionLinks'

/* The bottom nav's glyphs (components/MobileNav.vue), for the shell's sidebar. */
defineProps<{ id: SectionId }>()
</script>

<template>
  <!-- Hem: the stripes -->
  <svg v-if="id === 'hem'" viewBox="0 0 24 24" class="size-5" fill="currentColor" aria-hidden="true">
    <rect x="4" y="3" width="4" height="18" rx="1.5" /><rect x="10" y="3" width="4" height="18" rx="1.5" opacity=".55" /><rect x="16" y="3" width="4" height="18" rx="1.5" />
  </svg>
  <!-- Stories: a front page -->
  <svg v-else-if="id === 'stories'" viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M7 8.5h10M7 12h6M7 15.5h6" /><rect x="14.5" y="11.5" width="2.5" height="4.5" rx=".6" fill="currentColor" stroke="none" />
  </svg>
  <!-- Snacket: a speech bubble -->
  <svg v-else-if="id === 'snacket'" viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 5h16v11H10l-5 4v-4H4z" /><circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="10.5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="10.5" r="1" fill="currentColor" stroke="none" />
  </svg>
  <!-- Lyssna: headphones -->
  <svg v-else viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3.5" y="13.5" width="4.5" height="6.5" rx="1.8" /><rect x="16" y="13.5" width="4.5" height="6.5" rx="1.8" />
  </svg>
</template>
