<script setup lang="ts">
/*
 * The supporter account, in one dialog: sign in with a code by e-mail, choose how you're
 * known on the stands, sign out. Native <dialog> like the others — a centred
 * card on desktop, a bottom sheet on phones.
 */
const auth = useAuth()
const { status, profile, profileStatus } = auth
const open = useAccountDialog()
const editor = useProfileEditor()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const editing = ref(false)
let opener: HTMLElement | null = null

watch(open, (isOpen) => {
  const el = dialog.value
  if (!el) return
  if (isOpen) {
    editing.value = editor.editing.value
    editor.editing.value = false
    opener = document.activeElement as HTMLElement | null
    if (!el.open) el.showModal()
    document.documentElement.classList.add('dialog-open')
  }
  else if (el.open) {
    el.close()
  }
})

// Opened before this component mounted (e.g. from another page): show it right away.
onMounted(() => {
  if (open.value && dialog.value && !dialog.value.open) {
    editing.value = editor.editing.value
    editor.editing.value = false
    dialog.value.showModal()
    document.documentElement.classList.add('dialog-open')
  }
})

function onClose() {
  document.documentElement.classList.remove('dialog-open')
  open.value = false
  opener?.focus({ preventScroll: true })
}

function onClick(e: MouseEvent) {
  const el = dialog.value
  if (!el || e.target !== el) return
  const r = el.getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) open.value = false
}

async function signOut() {
  await auth.signOut()
  open.value = false
}

onBeforeUnmount(() => document.documentElement.classList.remove('dialog-open'))
</script>

<template>
  <dialog ref="dialog" class="account-dialog text-krita" aria-labelledby="account-title" @close="onClose" @click="onClick">
    <div class="stripes h-1.5 [--stripe:10px]" aria-hidden="true" />
    <div class="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
    <div class="px-5 pb-6 pt-3 sm:px-7 sm:pb-7 sm:pt-5">
      <div class="flex items-start justify-between gap-3">
        <p class="kicker text-guld">Ditt konto</p>
        <button class="grid size-9 shrink-0 place-items-center rounded-full text-krita-dim hover:bg-white/10 hover:text-krita" aria-label="Stäng" @click="open = false">
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <!-- Signed out: sign in with a six-digit code by e-mail -->
      <template v-if="status === 'signed-out' || status === 'loading'">
        <h2 id="account-title" class="mt-1 font-display text-3xl font-bold leading-tight">Kliv in på läktaren</h2>
        <p class="mt-2 text-sm leading-relaxed text-krita-dim">
          Logga in för att publicera i Snacket på stan med din egen supporterprofil.
          Nyheter, matcher och poddar är öppna för alla, inloggad eller inte.
        </p>

        <SignInWithCode v-if="status === 'signed-out'" />
        <p v-else class="mt-5 text-sm text-krita-dim" aria-live="polite">Ett ögonblick…</p>

        <p class="mt-5 flex gap-2.5 text-xs leading-relaxed text-krita-dim">
          <span aria-hidden="true">🔒</span>
          <span>Din e-postadress används bara för att logga in. Den visas aldrig för andra – du väljer själv vad du heter på läktaren.</span>
        </p>
      </template>

      <!-- Signed in, no profile yet (or editing it) -->
      <template v-else-if="status === 'signed-in' && (profileStatus === 'missing' || editing)">
        <h2 id="account-title" class="mt-1 font-display text-3xl font-bold leading-tight">{{ editing ? 'Ändra profil' : 'Välkommen in! 💙' }}</h2>
        <p v-if="!editing" class="mt-2 text-sm leading-relaxed text-krita-dim">Välj hur du syns på läktaren. Det är namnet du publicerar med i Snacket på stan, och det syns för alla när du har skrivit något.</p>
        <ProfileForm class="mt-5" :initial="editing ? profile : null" @saved="editing = false" @cancel="editing = false" />
        <button v-if="!editing" class="mt-4 text-xs font-semibold text-krita-dim underline decoration-white/20 underline-offset-2 hover:text-krita" @click="signOut">Logga ut</button>
      </template>

      <!-- Signed in, profile ready -->
      <template v-else-if="status === 'signed-in' && profileStatus === 'ready' && profile">
        <h2 id="account-title" class="sr-only">Ditt konto</h2>
        <div class="mt-3 flex items-center gap-4">
          <Avatar :name="profile.displayName" :design="profile.avatar" />
          <div class="min-w-0">
            <p class="truncate font-display text-2xl font-bold leading-tight">{{ profile.displayName }}</p>
            <p class="truncate text-sm text-krita-dim">@{{ profile.handle }}</p>
          </div>
        </div>
        <p class="mt-4 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm leading-relaxed text-krita-dim">
          Du publicerar i Snacket på stan med den här profilen. Namn, handle, avatar och text om dig syns för alla när du har skrivit något – din e-postadress aldrig.
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <NuxtLink :to="supporterPath(profile.id)" class="rounded-full bg-guld px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" @click="open = false">Din läktarplats</NuxtLink>
          <button class="rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold transition hover:border-himmel hover:text-himmel" @click="editing = true">Ändra profil</button>
          <button class="rounded-full px-5 py-2.5 text-sm font-bold text-krita-dim transition hover:text-krita" @click="signOut">Logga ut</button>
        </div>
      </template>

      <!-- Signed in, profile still loading or failed -->
      <template v-else-if="status === 'signed-in'">
        <h2 id="account-title" class="mt-1 font-display text-2xl font-bold">Ditt konto</h2>
        <p v-if="profileStatus === 'error'" class="mt-3 text-sm text-krita-dim" role="alert">
          Vi kunde inte hämta din profil just nu.
          <button class="font-semibold text-himmel underline underline-offset-2" @click="auth.loadProfile()">Försök igen</button>
        </p>
        <p v-else class="mt-3 text-sm text-krita-dim" aria-live="polite">Hämtar din profil…</p>
        <button class="mt-4 text-xs font-semibold text-krita-dim underline decoration-white/20 underline-offset-2 hover:text-krita" @click="signOut">Logga ut</button>
      </template>

      <template v-else>
        <h2 id="account-title" class="mt-1 font-display text-2xl font-bold">Inloggning kommer snart</h2>
        <p class="mt-2 text-sm text-krita-dim">Inloggning är inte påslagen här ännu. Allt annat fungerar som vanligt.</p>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.account-dialog {
  position: fixed;
  inset: auto 0 0 0;
  margin: 0;
  width: 100%;
  max-width: 100%;
  max-height: 92dvh;
  padding: 0 0 env(safe-area-inset-bottom);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-bottom: 0;
  border-radius: 1.5rem 1.5rem 0 0;
  background: var(--color-navy-900);
  box-shadow: 0 -24px 80px -20px rgb(3 9 21 / 0.9);
}
@media (min-width: 640px) {
  .account-dialog {
    inset: 0;
    margin: auto;
    width: min(30rem, calc(100% - 3rem));
    height: fit-content;
    padding: 0;
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 1.75rem;
  }
}
.account-dialog::backdrop {
  background: rgb(3 9 21 / 0.65);
  backdrop-filter: blur(6px);
}
@media (prefers-reduced-motion: no-preference) {
  .account-dialog[open] { animation: sheet-in 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 640px) {
  .account-dialog[open] { animation-name: pop-in; }
}
@keyframes sheet-in { from { transform: translateY(100%); } }
@keyframes pop-in { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
</style>
