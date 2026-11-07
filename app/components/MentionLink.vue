<script setup lang="ts">
/*
 * An @mention in a published post or comment. A link to that supporter's
 * page once it's confirmed to be a supporter you may see (see
 * lib/mentions): a real <a href>, so opening it in a new tab and the
 * browser's own menu work as usual. A former handle leads to the supporter
 * it permanently belongs to, at their current address. Anything else is
 * just text.
 */
const props = defineProps<{ handle: string }>()

const mentions = useMentions()
const links = useSectionLinks()
const target = computed(() => mentions.target(props.handle))

onMounted(() => mentions.request([props.handle]))
watch(() => props.handle, h => mentions.request([h]))
</script>

<template>
  <NuxtLink
    v-if="target"
    :to="links.supporter(target.handle)"
    class="font-semibold text-himmel underline-offset-2 hover:underline"
    :title="`${target.name} på läktaren`"
  >@{{ handle }}</NuxtLink>
  <template v-else>@{{ handle }}</template>
</template>
