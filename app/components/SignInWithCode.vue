<script setup lang="ts">
import { CODE_LENGTH, normalizeCode } from '~/lib/auth'

/*
 * Sign in with a six-digit code sent by e-mail. Two steps, never leaving the
 * page: 1) your address, 2) the code. iOS can offer the code straight from
 * Mail (autocomplete="one-time-code"); a pasted "123 456" works too.
 */
const auth = useAuth()
const { pendingEmail } = auth
const now = useNow(1000)

const email = ref(pendingEmail.value ?? '')
const code = ref('')
const busy = ref(false)
const message = ref<string | null>(null)
const emailInvalid = ref(false)
const sentNotice = ref(false)

const emailInput = useTemplateRef<HTMLInputElement>('emailInput')
const codeInput = useTemplateRef<HTMLInputElement>('codeInput')

const step = computed(() => (pendingEmail.value ? 'code' : 'email'))
const wait = computed(() => auth.resendIn(now.value ?? Date.now()))
const waitLabel = computed(() => `${Math.floor(wait.value / 60)}:${String(wait.value % 60).padStart(2, '0')}`)

watch(step, async (s) => {
  message.value = null
  await nextTick()
  if (s === 'code') codeInput.value?.focus()
  else emailInput.value?.focus()
})
onMounted(() => (step.value === 'code' ? codeInput.value : emailInput.value)?.focus({ preventScroll: true }))

async function send() {
  busy.value = true
  message.value = null
  emailInvalid.value = false
  const r = await auth.requestCode(email.value)
  busy.value = false
  if (r.ok) {
    code.value = ''
    sentNotice.value = true
    return
  }
  message.value = r.message
  emailInvalid.value = r.field === 'email'
}

async function resend() {
  if (wait.value > 0 || !pendingEmail.value) return
  email.value = pendingEmail.value
  await send()
  if (!message.value) codeInput.value?.focus()
}

async function verify() {
  if (busy.value || code.value.length !== CODE_LENGTH) return
  busy.value = true
  message.value = null
  const r = await auth.verifyCode(code.value)
  busy.value = false
  if (!r.ok) {
    message.value = r.message
    code.value = ''
    await nextTick()
    codeInput.value?.focus()
  }
  // On success the account dialog moves on by itself (profile step or profile).
}

function onCodeInput(e: Event) {
  code.value = normalizeCode((e.target as HTMLInputElement).value)
  if (code.value.length === CODE_LENGTH) void verify()
}

function changeAddress() {
  auth.cancelCode()
  sentNotice.value = false
  code.value = ''
}
</script>

<template>
  <!-- Step 1: e-mail address -->
  <form v-if="step === 'email'" class="mt-5" novalidate @submit.prevent="send">
    <label class="block">
      <span class="text-sm font-semibold">Din e-postadress</span>
      <input
        ref="emailInput"
        autofocus
        v-model="email"
        type="email"
        inputmode="email"
        autocomplete="email"
        autocapitalize="none"
        spellcheck="false"
        placeholder="namn@exempel.se"
        class="mt-1.5 w-full rounded-2xl border bg-navy-950 px-4 py-3.5 text-base outline-none transition focus:border-himmel"
        :class="emailInvalid ? 'border-rod' : 'border-white/12'"
        :aria-invalid="emailInvalid"
        aria-describedby="signin-message"
      >
    </label>
    <button type="submit" class="mt-4 w-full rounded-full bg-guld px-5 py-3.5 text-sm font-bold text-navy-950 transition enabled:hover:-translate-y-0.5 disabled:opacity-60" :disabled="busy">
      {{ busy ? 'Skickar…' : 'Skicka kod' }}
    </button>
    <p id="signin-message" class="mt-3 min-h-5 text-sm" :class="message ? 'text-rod' : 'text-krita-dim'" role="status" aria-live="polite">
      <template v-if="message">{{ message }}</template>
      <template v-else>Vi mejlar en sexsiffrig kod. Inget lösenord att komma ihåg.</template>
    </p>
  </form>

  <!-- Step 2: the code -->
  <form v-else class="mt-5" novalidate @submit.prevent="verify">
    <p class="text-sm leading-relaxed text-krita-dim" aria-live="polite">
      <template v-if="sentNotice">Klart! </template>Vi har skickat en kod till <span class="font-semibold text-krita">{{ pendingEmail }}</span>.
    </p>
    <label class="mt-4 block">
      <span class="sr-only">Sexsiffrig kod</span>
      <input
        ref="codeInput"
        autofocus
        :value="code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]*"
        :maxlength="CODE_LENGTH + 2"
        placeholder="• • • • • •"
        class="w-full rounded-2xl border bg-navy-950 px-4 py-4 text-center font-display text-3xl font-bold tracking-[0.45em] tabular-nums outline-none transition placeholder:text-krita-dim/40 focus:border-himmel"
        :class="message ? 'border-rod' : 'border-white/12'"
        :aria-invalid="!!message"
        aria-describedby="code-message"
        @input="onCodeInput"
      >
    </label>
    <button type="submit" class="mt-4 w-full rounded-full bg-guld px-5 py-3.5 text-sm font-bold text-navy-950 transition enabled:hover:-translate-y-0.5 disabled:opacity-60" :disabled="busy || code.length !== CODE_LENGTH">
      {{ busy ? 'Kollar koden…' : 'Logga in' }}
    </button>
    <p id="code-message" class="mt-3 min-h-5 text-sm" :class="message ? 'text-rod' : 'text-krita-dim'" role="status" aria-live="polite">
      <template v-if="message">{{ message }}</template>
      <template v-else>Hittar du inte mejlet? Kolla skräpposten – det kan ta en minut.</template>
    </p>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <button type="button" class="font-semibold text-himmel disabled:text-krita-dim disabled:no-underline hover:underline" :disabled="wait > 0 || busy" @click="resend">
        <template v-if="wait > 0">Ny kod om {{ waitLabel }}</template>
        <template v-else>Skicka ny kod</template>
      </button>
      <button type="button" class="font-semibold text-krita-dim hover:text-krita" @click="changeAddress">Ändra adress</button>
    </div>
  </form>
</template>
