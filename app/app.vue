<template>
  <div class="status-bar-backdrop" aria-hidden="true" />
  <NuxtPage />
  <!-- Shared by every page, so moving between them never stops a podcast or closes your account -->
  <PodcastAudio />
  <!-- Floating, wherever the desktop rail (with its docked player) isn't shown -->
  <MiniPlayer />
  <AccountDialog />
</template>
