<script setup lang="ts">
import type { Sport, Story } from '#shared/types/domain'

/*
 * One composer, two homes: at the top of Snacket på stan, and in the
 * "Snacka om detta" dialog, where `story` locks the attachment and the
 * text is bound to that Story's draft via v-model:body.
 */
const props = defineProps<{ story?: Story, autofocus?: boolean }>()
const body = defineModel<string>('body', { default: '' })
const emit = defineEmits<{ published: [postId: string, text: string] }>()

const { me, identity, owner, publish, filter } = useSnacket()
const { stories } = useNews()
const accountOpen = useAccountDialog()
const { sport: sportFilter } = useSport()

const MAX = 280
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

// Text typed as one person is never posted as the next. (The Story composer's
// text is that Story's draft, which is already kept per person.)
if (!props.story) watch(owner, (_next, prev) => { if (prev) body.value = '' })

function submit() {
  if (!me.value || !body.value.trim() || left.value < 0) return
  const text = body.value.trim()
  const id = publish(text, {
    sport: sport.value,
    storyId: props.story?.id ?? (storyId.value || undefined),
    keepView: inline.value,
  })
  body.value = ''
  if (inline.value) {
    if (id) emit('published', id, text)
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
      <Avatar :name="me?.name ?? 'Du'" :size="inline ? 'sm' : undefined" />
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
      <span class="ml-auto text-xs tabular-nums" :class="left < 0 ? 'text-rod font-bold' : left < 40 ? 'text-guld' : 'text-krita-dim'">{{ left }}</span>
      <!-- Signed in without a name yet: choose one first, the text waits -->
      <button
        v-if="identity.kind === 'needs-profile'"
        type="button"
        class="rounded-full bg-guld px-5 py-2 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5"
        @click="accountOpen = true"
      >
        Välj läktarnamn först
      </button>
      <button
        v-else
        type="submit"
        class="rounded-full bg-himmel px-5 py-2 text-sm font-bold text-navy-950 transition enabled:hover:-translate-y-0.5 enabled:hover:bg-himmel-300 disabled:opacity-40"
        :disabled="!me || !body.trim() || left < 0"
      >
        Släng ut det
      </button>
    </div>
  </form>
</template>
