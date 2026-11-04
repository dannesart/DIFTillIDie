<script setup lang="ts">
import type { Story } from '#shared/types/domain'

/*
 * Stories to attach, as a listbox. Shown by the `#` suggestions and by
 * "Bifoga". Each shows the outlet's own headline and who published it.
 * Focus never moves here: the text field keeps it (aria-activedescendant),
 * so the phone keyboard stays up and nothing is typed into the void.
 */
const props = defineProps<{
  id: string
  stories: Story[]
  active: number
  label: string
  /** One line per headline, and no scrolling of its own: for the popup at the caret. */
  compact?: boolean
}>()
const emit = defineEmits<{ choose: [story: Story], hover: [index: number] }>()

const now = useDemoNow()
const optionId = (i: number) => `${props.id}-${i}`
defineExpose({ optionId })

// Arrowing through a list that scrolls keeps the active one in sight.
watch(() => props.active, (i) => {
  if (i >= 0) nextTick(() => document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' }))
})

function byline(story: Story) {
  const lead = leadOf(story)
  const by = lead.publisher && lead.publisher !== lead.outlet ? `${lead.outlet} (${lead.publisher})` : lead.outlet
  const more = story.sources.length > 1 ? ` · +${story.sources.length - 1} ${story.sources.length === 2 ? 'källa' : 'källor'}` : ''
  return `${by} · ${timeAgo(story.updatedAt, now.value)}${more}`
}
</script>

<template>
  <ul :id="id" role="listbox" :aria-label="label" class="py-1" :class="!compact && 'max-h-72 overflow-y-auto overscroll-contain'">
    <!-- mousedown.prevent: picking must not take focus from the text field (combobox pattern) -->
    <li
      v-for="(s, i) in stories"
      :id="optionId(i)"
      :key="s.id"
      role="option"
      :aria-selected="i === active"
      class="cursor-pointer rounded-xl px-3 transition-colors"
      :class="[i === active ? 'bg-himmel/15 text-krita' : 'hover:bg-white/[0.05]', compact ? 'py-2' : 'py-2.5']"
      @mousedown.prevent
      @mousemove="i !== active && emit('hover', i)"
      @click="emit('choose', s)"
    >
      <span class="text-sm font-semibold leading-snug" :class="compact ? 'line-clamp-1' : 'line-clamp-2'">{{ leadOf(s).headline }}</span>
      <span class="mt-0.5 block truncate text-xs text-krita-dim">{{ byline(s) }}</span>
    </li>
  </ul>
</template>
