<script setup lang="ts">
/* What the account looks like: your initials once you have a profile, otherwise a quiet person icon. */
defineProps<{ compact?: boolean }>()
const { status, profile, profileStatus } = useAuth()
const needsProfile = computed(() => status.value === 'signed-in' && profileStatus.value === 'missing')
</script>

<template>
  <span class="relative grid place-items-center" aria-hidden="true">
    <Avatar v-if="status === 'signed-in' && profile" :name="profile.displayName" size="sm" :class="compact && 'size-6! text-[0.55rem]!'" />
    <svg v-else viewBox="0 0 24 24" :class="compact ? 'size-6' : 'size-5'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4" />
    </svg>
    <span v-if="needsProfile" class="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-guld ring-2 ring-navy-950" />
  </span>
</template>
