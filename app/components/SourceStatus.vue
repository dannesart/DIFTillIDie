<script setup lang="ts">
import type { FeedStatus } from '#shared/types/domain'

/* Honest, compact report of where the news came from and how fresh it is. */
defineProps<{ sources: FeedStatus[], generatedAt?: string }>()

const label = (s: FeedStatus) => (s.id.startsWith('sportbladet-') ? `${s.outlet} ${s.id.split('-')[1]}` : s.outlet)
</script>

<template>
  <div v-if="sources.length" class="flex flex-wrap items-center gap-2 text-xs">
    <span class="kicker mr-1 text-krita-dim">Källor</span>
    <a
      v-for="s in sources"
      :key="s.id"
      :href="s.homepage"
      target="_blank"
      rel="noopener"
      class="chip border-white/10 text-krita-dim hover:border-himmel/50 hover:text-krita"
      :title="s.error ? `Senaste hämtningen misslyckades: ${s.error}` : `${s.publisher} · ${s.itemCount} artiklar i flödet`"
    >
      <span class="size-1.5 rounded-full" :class="s.ok ? 'bg-himmel' : s.stale ? 'bg-guld' : 'bg-rod'" />
      <span class="font-semibold text-krita">{{ label(s) }}</span>
      <template v-if="s.ok">{{ s.relevantCount }} om DIF</template>
      <template v-else-if="s.stale">nås inte · visar hämtning <TimeAgo v-if="s.fetchedAt" :at="s.fetchedAt" /></template>
      <template v-else>nås inte just nu</template>
    </a>
    <span v-if="generatedAt" class="ml-auto text-krita-dim">Uppdaterat <TimeAgo :at="generatedAt" /></span>
  </div>
</template>
