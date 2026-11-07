<script setup lang="ts">
import type { Story } from '#shared/types/domain'
import { matchStories, moveActive } from '~/lib/storyLookup'

/*
 * "Bifoga": search the Stories already on the page and attach one. The
 * same list as the `#` suggestions, for anyone who doesn't know (or want)
 * the syntax, including before a single word is written. Every result is
 * listed; the compose dialog scrolls them, with the search kept on top.
 */
const props = defineProps<{ stories: Story[] }>()
const emit = defineEmits<{ choose: [story: Story], close: [] }>()

const query = ref('')
const active = ref(-1)
const results = computed(() => matchStories(props.stories, query.value))
watch(results, () => (active.value = -1))

const uid = useId()
const listId = `${uid}-list`
const list = useTemplateRef<{ optionId: (i: number) => string }>('list')
const input = useTemplateRef<HTMLInputElement>('input')
onMounted(() => input.value?.focus())

function onKey(e: KeyboardEvent) {
  const n = results.value.length
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
    e.preventDefault()
    active.value = moveActive(active.value, e.key === 'ArrowDown' ? 1 : -1, n)
  }
  else if (e.key === 'Enter') {
    // A search field has no new lines: Enter takes the active result, or the best one.
    e.preventDefault()
    const s = results.value[Math.max(0, active.value)]
    if (s) emit('choose', s)
  }
  else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <div class="basis-full rounded-2xl border border-white/10 bg-navy-950 p-2">
    <!--
      Stays in view while the results scroll by (with the dialog); opaque, so they pass beneath it.
      The negative top is the dialog body's top padding, so it sticks at the very edge with nothing peeking above.
    -->
    <div class="sticky -top-3 z-10 -mx-2 -mt-2 flex sm:-top-5 items-center gap-2 rounded-t-2xl bg-navy-950 px-3 pb-1 pt-2">
      <label class="min-w-0 flex-1">
        <span class="sr-only">Sök bland Stories</span>
        <input
          ref="input"
          v-model="query"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="listId"
          :aria-activedescendant="active >= 0 ? list?.optionId(active) : undefined"
          enterkeyhint="done"
          autocomplete="off"
          placeholder="Sök Story, t.ex. derby eller tränare"
          class="w-full rounded-xl bg-white/[0.04] px-3 py-2 text-base outline-none placeholder:text-krita-dim/70 focus-visible:ring-1 focus-visible:ring-himmel sm:text-sm"
          @keydown="onKey"
        >
      </label>
      <button type="button" class="shrink-0 rounded-full px-3 py-2 text-xs font-semibold text-krita-dim hover:text-krita" @click="emit('close')">Stäng</button>
    </div>
    <StoryOptions v-if="results.length" :id="listId" ref="list" class="mt-1" :stories="results" :active="active" label="Stories att bifoga" @choose="emit('choose', $event)" @hover="active = $event" />
    <p v-else class="px-3 py-3 text-sm text-krita-dim">
      <template v-if="stories.length">Ingen Story matchar ”{{ query.trim() }}”.</template>
      <template v-else>Inga Stories att bifoga just nu.</template>
    </p>
    <p class="sr-only" aria-live="polite">{{ results.length ? `${results.length} Stories. Pil ned för att välja.` : 'Inga Stories matchar.' }}</p>
  </div>
</template>
