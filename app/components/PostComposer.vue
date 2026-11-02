<script setup lang="ts">
import type { Sport, Story } from '#shared/types/domain'

/*
 * One composer, two homes: at the top of Snacket på stan, and inside a
 * Story card ("Snacka om detta"), where `story` locks the attachment.
 */
const props = defineProps<{ story?: Story, autofocus?: boolean }>()
const emit = defineEmits<{ published: [postId: string] }>()

const { me, publish, filter } = useSnacket()
const { stories } = useNews()
const { sport: sportFilter } = useSport()

const MAX = 280
const body = ref('')
const sport = ref<Sport | undefined>()
const storyId = ref('')
const focused = ref(false)
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

const inline = computed(() => !!props.story)
const attached = computed(() => props.story ?? stories.value.find(s => storyAnswersTo(s, storyId.value)))

const prompts = ['Vad snackas det om på stan?', 'Hur kändes det i kväll?', 'Vem ska starta på lördag?', 'Någon som ska på bortamatchen?']
const storyPrompts = ['Vad tycker du?', 'Säg din sak, Djurgårdare.', 'Hur ser du på det här?', 'Ditt hjärta, dina ord.']
const prompt = ref((inline.value ? storyPrompts : prompts)[0])
onMounted(() => {
  const list = inline.value ? storyPrompts : prompts
  prompt.value = list[Math.floor(Math.random() * list.length)]!
  if (props.autofocus) nextTick(() => textarea.value?.focus({ preventScroll: true }))
})

if (props.story) sport.value = props.story.sport
else watch(sportFilter, s => (sport.value = s === 'alla' ? undefined : s), { immediate: true })

// Browsing Snacket for one Story? Then a new post is most likely about it.
if (!props.story) {
  watch(() => filter.value.storyId, (id) => {
    if (id && stories.value.some(s => storyAnswersTo(s, id))) storyId.value = id
  }, { immediate: true })
}

const left = computed(() => MAX - body.value.length)
const expanded = computed(() => inline.value || focused.value || body.value.length > 0)

function submit() {
  if (!body.value.trim() || left.value < 0) return
  const id = publish(body.value, {
    sport: sport.value,
    storyId: props.story?.id ?? (storyId.value || undefined),
    keepView: inline.value,
  })
  body.value = ''
  if (inline.value) {
    if (id) emit('published', id)
    return
  }
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

defineExpose({ mention, focus: () => textarea.value?.focus() })
</script>

<template>
  <form
    class="p-4 transition duration-300 sm:p-5"
    :class="[inline ? 'rounded-2xl border border-white/10 bg-navy-950/60' : 'card', expanded && !inline && 'border-himmel/40 shadow-[0_20px_60px_-30px_rgb(95_176_236/0.6)]']"
    @submit.prevent="submit"
  >
    <div class="flex gap-3">
      <Avatar :name="me.name" :size="inline ? 'sm' : undefined" />
      <label class="min-w-0 flex-1">
        <span class="sr-only">{{ inline ? 'Skriv om den här Storyn' : 'Skriv ett inlägg' }}</span>
        <textarea
          ref="textarea"
          v-model="body"
          :rows="expanded ? 3 : 1"
          :placeholder="prompt"
          class="w-full resize-none bg-transparent leading-relaxed placeholder:text-krita-dim/70 focus:outline-none"
          :class="inline ? 'pt-1 text-[0.95rem]' : 'pt-2.5 text-base'"
          @focus="focused = true"
          @blur="focused = false"
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
      </label>
    </div>

    <div v-show="expanded" class="mt-3 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3" @mousedown.prevent>
      <template v-if="!inline">
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
        <!-- An attached Story shows as a chip; otherwise pick one -->
        <span v-if="attached" class="chip max-w-[16rem] border-himmel/40 bg-himmel/10 text-himmel">
          <span class="truncate">Om: {{ leadOf(attached).headline }}</span>
          <button type="button" class="ml-0.5 shrink-0 opacity-70 hover:opacity-100" aria-label="Ta bort kopplingen till Storyn" @click="storyId = ''">✕</button>
        </span>
        <select v-else v-model="storyId" class="chip max-w-[14rem] cursor-pointer border-white/12 bg-navy-900 text-krita-dim focus:outline-none" aria-label="Koppla till en Story" @mousedown.stop>
          <option value="">Koppla till en Story…</option>
          <option v-for="s in stories" :key="s.id" :value="s.id">{{ leadOf(s).outlet }}: {{ leadOf(s).headline.slice(0, 60) }}</option>
        </select>
      </template>
      <span v-else class="text-xs text-krita-dim">
        <span aria-hidden="true">🔒</span> Sparas bara i din webbläsare
      </span>
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
