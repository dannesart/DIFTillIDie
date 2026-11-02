<script setup lang="ts">
import type { Sport } from '#shared/types/domain'

const { me, publish } = useSnacket()
const { stories } = useNews()
const { sport: sportFilter } = useSport()

const MAX = 280
const body = ref('')
const sport = ref<Sport | undefined>()
const storyId = ref('')
const focused = ref(false)
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

const prompts = ['Vad snackas det om på stan?', 'Hur kändes det i kväll?', 'Vem ska starta på lördag?', 'Någon som ska på bortamatchen?']
const prompt = ref(prompts[0])
onMounted(() => (prompt.value = prompts[Math.floor(Math.random() * prompts.length)]))

watch(sportFilter, s => (sport.value = s === 'alla' ? undefined : s), { immediate: true })

const left = computed(() => MAX - body.value.length)
const expanded = computed(() => focused.value || body.value.length > 0)

function submit() {
  if (!body.value.trim() || left.value < 0) return
  publish(body.value, { sport: sport.value, storyId: storyId.value || undefined })
  body.value = ''
  storyId.value = ''
  textarea.value?.blur()
  document.getElementById('snacket')?.scrollIntoView({ behavior: 'smooth' })
}

function mention(handle: string) {
  const tag = `@${handle} `
  if (!body.value.includes(tag)) body.value = `${body.value}${body.value && !body.value.endsWith(' ') ? ' ' : ''}${tag}`
  textarea.value?.focus()
  textarea.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

defineExpose({ mention })
</script>

<template>
  <form class="card p-4 transition duration-300 sm:p-5" :class="expanded && 'border-himmel/40 shadow-[0_20px_60px_-30px_rgb(95_176_236/0.6)]'" @submit.prevent="submit">
    <div class="flex gap-3">
      <Avatar :name="me.name" />
      <label class="min-w-0 flex-1">
        <span class="sr-only">Skriv ett inlägg</span>
        <textarea
          ref="textarea"
          v-model="body"
          :rows="expanded ? 3 : 1"
          :placeholder="prompt"
          class="w-full resize-none bg-transparent pt-2.5 text-base leading-relaxed placeholder:text-krita-dim/70 focus:outline-none"
          @focus="focused = true"
          @blur="focused = false"
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
      </label>
    </div>

    <div v-show="expanded || body" class="mt-3 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3" @mousedown.prevent>
      <button
        v-for="s in (['fotboll', 'hockey'] as const)"
        :key="s"
        type="button"
        class="chip capitalize"
        :class="sport === s ? 'border-himmel bg-himmel/15 text-himmel' : 'border-white/12 text-krita-dim hover:text-krita'"
        @click="sport = sport === s ? undefined : s"
      >
        {{ s }}
      </button>
      <select v-model="storyId" class="chip max-w-[14rem] cursor-pointer border-white/12 bg-navy-900 text-krita-dim focus:outline-none" aria-label="Koppla till en Story" @mousedown.stop>
        <option value="">Koppla till en Story…</option>
        <option v-for="s in stories" :key="s.id" :value="s.id">{{ leadOf(s).outlet }}: {{ leadOf(s).headline.slice(0, 60) }}</option>
      </select>
      <span class="ml-auto text-xs tabular-nums" :class="left < 0 ? 'text-rod font-bold' : left < 40 ? 'text-guld' : 'text-krita-dim'">{{ left }}</span>
      <button
        type="submit"
        class="rounded-full bg-himmel px-5 py-2 text-sm font-bold text-navy-950 transition enabled:hover:-translate-y-0.5 enabled:hover:bg-himmel-300 disabled:opacity-40"
        :disabled="!body.trim() || left < 0"
      >
        Släng ut det
      </button>
    </div>
  </form>
</template>
