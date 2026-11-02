<script setup lang="ts">
import type { FeedMode } from '~/composables/useSnacket'

const { feed, all, mode, filter, me, setName } = useSnacket()
const { stories } = useNews()

const modes: { value: FeedMode, label: string, hint: string }[] = [
  { value: 'hetast', label: 'Hetast på stan', hint: 'Mest kärlek, svalnar med tiden' },
  { value: 'nyast', label: 'Nyast på stan', hint: 'Senaste först' },
]

const filterStory = computed(() => stories.value.find(s => storyAnswersTo(s, filter.value.storyId)))
const hasFilter = computed(() => !!(filter.value.tag || filter.value.storyId))

const tags = computed(() => {
  const counts = new Map<string, number>()
  for (const p of all.value) {
    for (const t of tokenize(p.body)) {
      if (t.type === 'tag') counts.set(t.value.toLowerCase(), (counts.get(t.value.toLowerCase()) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
})

const editingName = ref(false)
const nameDraft = ref('')
function startEditName() {
  nameDraft.value = me.value.name === 'Du' ? '' : me.value.name
  editingName.value = true
}
function saveName() {
  setName(nameDraft.value)
  editingName.value = false
}

const composer = useTemplateRef<{ mention: (h: string) => void }>('composer')
</script>

<template>
  <section id="snacket" class="relative scroll-mt-16 border-y border-white/8 bg-natt/60 py-16 lg:py-24">
    <div aria-hidden="true" class="stripes absolute inset-x-0 top-0 h-1 opacity-60 [--stripe:24px]" />
    <div class="mx-auto max-w-7xl px-4 sm:px-6">
      <div class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p class="kicker flex items-center gap-2 text-guld">Community <span class="rounded-full border border-guld/40 px-2 py-0.5">Demo · påhittade inlägg</span></p>
          <h2 class="section-title mt-3">Snacket <span class="italic font-normal text-himmel">på stan</span></h2>
        </div>

        <div class="relative grid grid-cols-2 rounded-full border border-white/10 bg-navy-900 p-1" role="tablist" aria-label="Sortera snacket">
          <span
            aria-hidden="true"
            class="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-krita transition-transform duration-500 ease-spring"
            :class="mode === 'nyast' && 'translate-x-full'"
          />
          <button
            v-for="m in modes"
            :key="m.value"
            role="tab"
            :aria-selected="mode === m.value"
            :title="m.hint"
            class="relative z-10 rounded-full px-4 py-2 text-sm font-bold transition-colors duration-300 sm:px-5"
            :class="mode === m.value ? 'text-navy-950' : 'text-krita-dim hover:text-krita'"
            @click="mode = m.value"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <div class="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0">
          <PostComposer ref="composer" />

          <div v-if="hasFilter" class="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <span class="text-krita-dim">Visar</span>
            <button class="chip border-guld/50 bg-guld/10 text-guld hover:bg-guld/20" @click="filter = {}">
              <template v-if="filter.tag">#{{ filter.tag }}</template>
              <template v-else-if="filterStory">Story: {{ leadOf(filterStory).headline }}</template>
              <span aria-hidden="true" class="ml-1">✕</span>
              <span class="sr-only">Rensa filter</span>
            </button>
          </div>

          <TransitionGroup
            tag="ul"
            class="relative mt-6 space-y-4"
            move-class="transition duration-500 ease-out-expo"
            enter-from-class="opacity-0 -translate-y-3"
            enter-active-class="transition duration-500"
            leave-to-class="opacity-0"
            leave-active-class="transition duration-200 absolute inset-x-0"
          >
            <li v-for="post in feed" :key="post.id">
              <PostCard :post="post" @mention="composer?.mention($event)" />
            </li>
          </TransitionGroup>
          <p v-if="!feed.length" class="mt-10 text-center text-krita-dim">
            Tyst på stan just här. Bli först att säga något!
          </p>
        </div>

        <aside class="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div class="card p-5">
            <p class="kicker text-krita-dim">Du på läktaren</p>
            <form v-if="editingName" class="mt-3 flex gap-2" @submit.prevent="saveName">
              <input v-model="nameDraft" maxlength="32" autofocus placeholder="Ditt läktarnamn" class="min-w-0 flex-1 rounded-full border border-white/12 bg-navy-950 px-4 py-2 text-sm outline-none focus:border-himmel">
              <button class="rounded-full bg-himmel px-4 text-sm font-bold text-navy-950">Spara</button>
            </form>
            <div v-else class="mt-3 flex items-center gap-3">
              <Avatar :name="me.name" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold">{{ me.name }}</p>
                <p class="truncate text-xs text-krita-dim">@{{ me.handle }}</p>
              </div>
              <button class="text-xs font-semibold text-himmel hover:underline" @click="startEditName">Byt namn</button>
            </div>
            <p class="mt-3 text-xs leading-relaxed text-krita-dim">Inget konto behövs än. Allt du gör sparas bara i den här webbläsaren.</p>
          </div>

          <div class="card p-5">
            <p class="kicker text-krita-dim">Det snackas om</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="[tag, count] in tags"
                :key="tag"
                class="chip"
                :class="filter.tag === tag ? 'border-guld bg-guld text-navy-950' : 'border-white/12 hover:border-guld/60 hover:text-guld'"
                @click="filter = filter.tag === tag ? {} : { tag }"
              >
                #{{ tag }} <span class="opacity-50">{{ count }}</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </section>
</template>
