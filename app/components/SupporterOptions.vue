<script setup lang="ts">
import type { PublicAuthor } from '#shared/utils/profile'

/*
 * Supporters to mention, as a listbox: the `@` suggestions in the post text.
 * Avatar, name and @handle. Like the Story suggestions (StoryOptions), focus
 * never moves here: the text field keeps it (aria-activedescendant), so the
 * phone keyboard stays up.
 */
const props = defineProps<{ id: string, supporters: PublicAuthor[], active: number, label: string }>()
const emit = defineEmits<{ choose: [supporter: PublicAuthor], hover: [index: number] }>()

const optionId = (i: number) => `${props.id}-${i}`
defineExpose({ optionId })
</script>

<template>
  <ul :id="id" role="listbox" :aria-label="label" class="py-1">
    <!-- mousedown.prevent: picking must not take focus from the text field (combobox pattern) -->
    <li
      v-for="(s, i) in supporters"
      :id="optionId(i)"
      :key="s.id"
      role="option"
      :aria-selected="i === active"
      class="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 transition-colors"
      :class="i === active ? 'bg-himmel/15 text-krita' : 'hover:bg-white/[0.05]'"
      @mousedown.prevent
      @mousemove="i !== active && emit('hover', i)"
      @click="emit('choose', s)"
    >
      <Avatar :name="s.name" :design="s.avatar" size="sm" />
      <span class="min-w-0">
        <span class="block truncate text-sm font-semibold leading-snug">{{ s.name }}</span>
        <span class="block truncate text-xs text-krita-dim">@{{ s.handle }}</span>
      </span>
    </li>
  </ul>
</template>
