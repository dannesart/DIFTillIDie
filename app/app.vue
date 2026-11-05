<template>
  <div class="status-bar-backdrop" aria-hidden="true" />
  <NuxtPage />
  <!-- Shared by every page, so moving between them never stops a podcast or closes your account -->
  <PodcastAudio />
  <MiniPlayer />
  <AccountDialog />
</template>
