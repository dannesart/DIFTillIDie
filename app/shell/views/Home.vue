<script setup lang="ts">
import { DESKTOP_QUERY, MOBILE_QUERY } from '~/lib/sectionLinks'

/*
 * The shell's front page (/). Desktop: Hem's overview. Phones and tablets:
 * the front page as it is, with its install hint. Both are in the server's
 * HTML, which can't know the screen; only the one that fits runs (see
 * useScreenParts), so neither builds, listens or fetches for the other.
 */
const Hem = defineLazyHydrationComponent('mediaQuery', () => import('~/shell/views/Hem.vue'))
const HomeSections = defineLazyHydrationComponent('mediaQuery', () => import('~/components/HomeSections.vue'))
const InstallHint = defineLazyHydrationComponent('mediaQuery', () => import('~/components/InstallHint.vue'))

const screen = useScreenParts()
</script>

<template>
  <div v-if="screen.desktop.value" class="hidden lg:block">
    <Hem :hydrate-on-media-query="DESKTOP_QUERY" />
  </div>
  <div v-if="screen.mobile.value" class="lg:hidden">
    <HomeSections :hydrate-on-media-query="MOBILE_QUERY" />
    <InstallHint :hydrate-on-media-query="MOBILE_QUERY" />
  </div>
</template>
