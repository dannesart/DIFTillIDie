<script setup lang="ts">
import { MOBILE_QUERY } from '~/lib/sectionLinks'
import Hem from '~/shell/views/Hem.vue'

/*
 * The shell's front page (/): Hem's overview, on every screen size. Snacket,
 * Stories and Lyssna are pages of their own (Issue #16); Hem previews them.
 * Phones and tablets also get the install hint, which only hydrates there.
 */
const InstallHint = defineLazyHydrationComponent('mediaQuery', () => import('~/components/InstallHint.vue'))

useHead({ title: 'Hem – Djurgår’n tills jag dör' })
</script>

<template>
  <Hem />
  <div class="lg:hidden">
    <InstallHint :hydrate-on-media-query="MOBILE_QUERY" />
  </div>
</template>
