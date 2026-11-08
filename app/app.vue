<template>
  <div class="status-bar-backdrop" aria-hidden="true" />
  <NuxtPage />
  <!-- Shared by every page, so moving between them never stops a podcast or closes your account -->
  <PodcastAudio />
  <!-- Phones and tablets; on desktop the same player sits in the sidebar (ShellNav) -->
  <MiniPlayer />
  <AccountDialog />
</template>
