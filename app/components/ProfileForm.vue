<script setup lang="ts">
import type { AvatarKey } from '#shared/utils/profile'
import { AVATARS, BIO_MAX } from '#shared/utils/profile'
import type { ProfileErrors } from '~/lib/auth'

/*
 * Choose how you're known on the stands: display name, unique handle, and
 * (optional) an avatar design and a few words about yourself. The one form
 * for creating and editing a profile, wherever it's opened from.
 */
const props = defineProps<{ initial?: { displayName: string, handle: string, bio?: string | null, avatar?: AvatarKey | null } | null }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const auth = useAuth()

const displayName = ref(props.initial?.displayName ?? '')
const handle = ref(props.initial?.handle ?? '')
const handleTouched = ref(!!props.initial)
const avatar = ref<AvatarKey | null>(props.initial?.avatar ?? null)
const bio = ref(props.initial?.bio ?? '')
const bioLeft = computed(() => BIO_MAX - [...bio.value.replace(/s+/g, ' ').trim()].length)
const errors = ref<ProfileErrors>({})
const saving = ref(false)

// Suggest a handle from the name until the supporter edits it themselves.
watch(displayName, (name) => {
  if (!handleTouched.value) handle.value = normalizeHandle(name)
})
const preview = computed(() => normalizeHandle(handle.value))
const liveHandleError = computed(() => (handleTouched.value && preview.value ? validateHandle(preview.value) : null))

async function submit() {
  saving.value = true
  errors.value = {}
  const r = await auth.saveProfile({ displayName: displayName.value, handle: handle.value, bio: bio.value, avatar: avatar.value })
  saving.value = false
  if (r.ok) emit('saved')
  else errors.value = r.errors
}
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="submit">
    <label class="block">
      <span class="text-sm font-semibold">Vad heter du på läktaren?</span>
      <input
        v-model="displayName"
        maxlength="40"
        autocomplete="nickname"
        placeholder="t.ex. Lotta från Gärdet"
        class="mt-1.5 w-full rounded-2xl border bg-navy-950 px-4 py-3 text-base outline-none transition focus:border-himmel"
        :class="errors.displayName ? 'border-rod' : 'border-white/12'"
        :aria-invalid="!!errors.displayName"
        aria-describedby="name-help"
      >
      <span id="name-help" class="mt-1 block text-xs" :class="errors.displayName ? 'text-rod' : 'text-krita-dim'">
        {{ errors.displayName ?? 'Ditt eget val – din e-postadress visas aldrig. 2–40 tecken.' }}
      </span>
    </label>

    <label class="block">
      <span class="text-sm font-semibold">Ditt handle</span>
      <span class="mt-1.5 flex items-center rounded-2xl border bg-navy-950 pl-4 transition focus-within:border-himmel" :class="errors.handle || liveHandleError ? 'border-rod' : 'border-white/12'">
        <span class="text-krita-dim" aria-hidden="true">@</span>
        <input
          v-model="handle"
          maxlength="24"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          placeholder="kaminen81"
          class="w-full bg-transparent py-3 pl-1 pr-4 text-base outline-none"
          :aria-invalid="!!(errors.handle || liveHandleError)"
          aria-describedby="handle-help"
          @input="handleTouched = true"
        >
      </span>
      <span id="handle-help" class="mt-1 block text-xs" :class="errors.handle || liveHandleError ? 'text-rod' : 'text-krita-dim'">
        <template v-if="errors.handle || liveHandleError">{{ errors.handle ?? liveHandleError }}</template>
        <template v-else-if="preview && preview !== handle">Blir <span class="font-semibold text-krita">@{{ preview }}</span>. </template>
        <template v-else>Unikt. 3–20 tecken: a–z, siffror och _. </template>
      </span>
    </label>

    <fieldset>
      <legend class="text-sm font-semibold">Din avatar</legend>
      <div class="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Välj avatar">
        <button
          v-for="a in [{ key: null, label: 'Dina egna ränder' }, ...AVATARS]"
          :key="a.key ?? 'randig'"
          type="button"
          role="radio"
          :aria-checked="avatar === a.key"
          :aria-label="a.label"
          :title="a.label"
          class="rounded-full p-0.5 ring-2 transition motion-safe:hover:-translate-y-0.5"
          :class="avatar === a.key ? 'ring-guld' : 'ring-transparent hover:ring-white/30'"
          @click="avatar = a.key"
        >
          <Avatar :name="displayName.trim() || 'Du'" :design="a.key" />
        </button>
      </div>
    </fieldset>

    <label class="block">
      <span class="text-sm font-semibold">Om dig <span class="font-normal text-krita-dim">(valfritt)</span></span>
      <textarea
        v-model="bio"
        rows="2"
        :maxlength="BIO_MAX + 20"
        placeholder="t.ex. Sektion A sedan -98. Kaffe i termosen, halsduken på."
        class="mt-1.5 w-full resize-none rounded-2xl border bg-navy-950 px-4 py-3 text-base outline-none transition focus:border-himmel"
        :class="errors.bio || bioLeft < 0 ? 'border-rod' : 'border-white/12'"
        :aria-invalid="!!errors.bio || bioLeft < 0"
        aria-describedby="bio-help"
      />
      <span id="bio-help" class="mt-1 flex gap-3 text-xs" :class="errors.bio || bioLeft < 0 ? 'text-rod' : 'text-krita-dim'">
        <span class="flex-1">{{ errors.bio ?? 'Syns för alla, precis som ditt namn, när du har skrivit eller kommenterat i Snacket. Skriv inget du inte vill att alla ska läsa.' }}</span>
        <span class="tabular-nums" aria-hidden="true">{{ bioLeft }}</span>
      </span>
    </label>

    <p v-if="errors.form" class="rounded-2xl bg-rod/10 px-4 py-3 text-sm text-rod" role="alert">{{ errors.form }}</p>

    <div class="flex flex-wrap items-center gap-2 pt-1">
      <button type="submit" class="rounded-full bg-guld px-6 py-3 text-sm font-bold text-navy-950 transition enabled:hover:-translate-y-0.5 disabled:opacity-50" :disabled="saving">
        {{ saving ? 'Sparar…' : initial ? 'Spara ändringar' : 'Spara profil' }}
      </button>
      <button v-if="initial" type="button" class="rounded-full px-4 py-3 text-sm font-semibold text-krita-dim hover:text-krita" @click="emit('cancel')">Avbryt</button>
    </div>
  </form>
</template>
