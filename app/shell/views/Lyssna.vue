<script setup lang="ts">
/* Shell view: podcasts and video, the site's own section, as a page of its own. */
useHead({ title: 'Lyssna & titta – Djurgår’n tills jag dör' })
</script>

<template>
  <!-- Phones: less empty space above the title, so the latest episode starts sooner (#16) -->
  <MediaSection class="pt-8 lg:pt-10" />
</template>
