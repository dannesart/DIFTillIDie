<script setup lang="ts">
import type { PodcastResponse } from '#shared/types/domain'

/*
 * Choose a show. Accessible tabs (arrow keys move between them), each with
 * its own cover, latest episode and — if it's the one playing — a little
 * equaliser, so you can always see where the sound is coming from.
 */
const props = defineProps<{ shows: PodcastResponse[], night?: boolean }>()
const active = defineModel<string>({ required: true })

const { currentShow, playing } = usePodcastPlayer()
const tabs = useTemplateRef<HTMLButtonElement[]>('tabs')

function onKey(e: KeyboardEvent, i: number) {
  const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!delta) return
  e.preventDefault()
  const next = (i + delta + props.shows.length) % props.shows.length
  active.value = props.shows[next]!.id
  tabs.value?.[next]?.focus()
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3" role="tablist" aria-label="Välj podd">
    <button
      v-for="(s, i) in shows"
      :id="`tab-${s.id}`"
      :key="s.id"
      ref="tabs"
      role="tab"
      :aria-selected="active === s.id"
      :aria-controls="`panel-${s.id}`"
      :tabindex="active === s.id ? 0 : -1"
      class="group relative flex min-w-0 items-center gap-3 rounded-2xl border p-2 pr-3 text-left transition duration-300 sm:p-3"
      :class="active === s.id ? 'border-himmel/50 bg-navy-900 shadow-[0_16px_40px_-24px_rgb(95_176_236/0.8)]' : 'border-white/8 bg-navy-900/40 hover:border-white/20'"
      @click="active = s.id"
      @keydown="onKey($event, i)"
    >
      <MediaCover :cover="s.cover" :title="s.show?.title ?? ''" kind="podd" class="hidden size-14 shrink-0 overflow-hidden rounded-xl sm:block [&_.kicker]:hidden [&_span.block]:hidden" />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5">
          <span class="truncate font-display text-base font-semibold sm:text-lg">{{ s.show?.title ?? s.status.outlet }}</span>
          <span v-if="currentShow?.id === s.id && playing" class="eq flex h-3 shrink-0 items-end gap-[2px]" aria-label="Spelas nu">
            <span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" />
          </span>
        </span>
        <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-krita-dim">
          <template v-if="s.episodes[0]">Nytt avsnitt <TimeAgo :at="s.episodes[0].publishedAt" /></template>
          <template v-else>Flödet nås inte</template>
          <span v-if="s.newcomer" class="font-semibold text-guld">Ny här 💙</span>
          <span v-else-if="night && s.nocturnal" class="font-semibold text-guld">🌙</span>
        </span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.eq span { height: 45%; }
@media (prefers-reduced-motion: no-preference) {
  .eq span { animation: eq 0.9s ease-in-out infinite; }
  .eq span:nth-child(2) { animation-delay: -0.3s; }
  .eq span:nth-child(3) { animation-delay: -0.6s; }
}
@keyframes eq {
  0%, 100% { height: 30%; }
  50% { height: 100%; }
}
</style>
