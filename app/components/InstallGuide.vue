<script setup lang="ts">
/*
 * "Lägg Djurgår'n på hemskärmen" — accurate steps for this device, or the
 * browser's own install dialog where one exists. Native <dialog>, like the
 * Story composer: a centred card on desktop, a bottom sheet on phones.
 */
const { guideOpen, canPrompt, platform, installed, prompt } = useInstall()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const result = ref<'accepted' | 'dismissed' | null>(null)
let opener: HTMLElement | null = null

watch(guideOpen, (open) => {
  const el = dialog.value
  if (!el) return
  if (open) {
    result.value = null
    opener = document.activeElement as HTMLElement | null
    if (!el.open) el.showModal()
    document.documentElement.classList.add('dialog-open')
  }
  else if (el.open) {
    el.close()
  }
})

function onClose() {
  document.documentElement.classList.remove('dialog-open')
  guideOpen.value = false
  opener?.focus({ preventScroll: true })
}

function onClick(e: MouseEvent) {
  const el = dialog.value
  if (!el || e.target !== el) return
  const r = el.getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) guideOpen.value = false
}

async function install() {
  const outcome = await prompt()
  if (outcome !== 'unavailable') result.value = outcome
}

onBeforeUnmount(() => document.documentElement.classList.remove('dialog-open'))
</script>

<template>
  <dialog ref="dialog" class="install-dialog text-krita" aria-labelledby="install-title" @close="onClose" @click="onClick">
    <div class="stripes h-1.5 [--stripe:10px]" aria-hidden="true" />
    <div class="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
    <div class="px-5 pb-6 pt-3 sm:px-7 sm:pb-7 sm:pt-5">
      <div class="flex items-start gap-4">
        <img src="/icons/icon-192.png" alt="" width="64" height="64" class="size-16 shrink-0 rounded-2xl shadow-[0_12px_30px_-12px_rgb(95_176_236/0.7)]">
        <div class="min-w-0 flex-1">
          <p class="kicker text-guld">Djurgår’n i fickan</p>
          <h2 id="install-title" class="mt-1 font-display text-2xl font-bold leading-tight">Lägg appen på hemskärmen</h2>
        </div>
        <button class="grid size-9 shrink-0 place-items-center rounded-full text-krita-dim hover:bg-white/10 hover:text-krita" aria-label="Stäng" @click="guideOpen = false">
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <p class="mt-3 text-sm leading-relaxed text-krita-dim">
        Öppnas direkt i helskärm, utan adressfält – med samma nyheter, snack och poddar som här.
      </p>

      <div v-if="installed || result === 'accepted'" class="mt-5 rounded-2xl bg-himmel/10 p-4 text-sm" role="status">
        💙 Klart! Djurgår’n finns nu på din hemskärm.
      </div>

      <!-- Chrome, Edge, Samsung Internet…: the browser's own dialog -->
      <div v-else-if="canPrompt" class="mt-5">
        <button class="w-full rounded-full bg-guld py-3 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" @click="install">
          Installera Djurgår’n
        </button>
        <p v-if="result === 'dismissed'" class="mt-2 text-center text-xs text-krita-dim">Inga problem – knappen finns kvar längst ned på sidan.</p>
      </div>

      <!-- iPhone & iPad: Safari (and other iOS browsers) via the share menu -->
      <ol v-else-if="platform === 'ios-safari' || platform === 'ios-other'" class="mt-5 space-y-3 text-sm">
        <li class="flex items-center gap-3">
          <span class="step">1</span>
          <span>Tryck på
            <span class="inline-flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 font-semibold">
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4" /><path d="M7 11H5v10h14V11h-2" /></svg>
              Dela
            </span>
            <template v-if="platform === 'ios-safari'"> i Safaris verktygsfält.</template>
            <template v-else> i webbläsarens adressfält eller meny.</template>
          </span>
        </li>
        <li class="flex items-center gap-3"><span class="step">2</span><span>Välj <strong>Lägg till på hemskärmen</strong> (scrolla ned i listan om du inte ser den).</span></li>
        <li class="flex items-center gap-3"><span class="step">3</span><span>Tryck på <strong>Lägg till</strong>. Klart – leta efter det randiga hjärtat.</span></li>
      </ol>

      <!-- Instagram/Facebook etc. can't add to the home screen -->
      <div v-else-if="platform === 'ios-inapp'" class="mt-5 rounded-2xl bg-white/[0.05] p-4 text-sm leading-relaxed">
        Den här appens inbyggda webbläsare kan inte lägga till på hemskärmen. Öppna sidan i <strong>Safari</strong> (via menyn ⋯ → Öppna i Safari) och följ stegen där.
      </div>

      <ol v-else-if="platform === 'android'" class="mt-5 space-y-3 text-sm">
        <li class="flex items-center gap-3"><span class="step">1</span><span>Öppna webbläsarens meny <strong>⋮</strong>.</span></li>
        <li class="flex items-center gap-3"><span class="step">2</span><span>Välj <strong>Installera app</strong> eller <strong>Lägg till på startskärmen</strong>.</span></li>
      </ol>

      <div v-else class="mt-5 rounded-2xl bg-white/[0.05] p-4 text-sm leading-relaxed text-krita-dim">
        Din webbläsare erbjuder ingen installation här. I Chrome och Edge finns en installera-ikon i adressfältet, och i Safari på Mac väljer du <strong class="text-krita">Arkiv → Lägg till i Dock</strong>.
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.install-dialog {
  position: fixed;
  inset: auto 0 0 0;
  margin: 0;
  width: 100%;
  max-width: 100%;
  max-height: 92dvh;
  padding: 0 0 env(safe-area-inset-bottom);
  overflow-y: auto;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-bottom: 0;
  border-radius: 1.5rem 1.5rem 0 0;
  background: var(--color-navy-900);
  box-shadow: 0 -24px 80px -20px rgb(3 9 21 / 0.9);
}
@media (min-width: 640px) {
  .install-dialog {
    inset: 0;
    margin: auto;
    width: min(30rem, calc(100% - 3rem));
    height: fit-content;
    padding: 0;
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 1.75rem;
  }
}
.install-dialog::backdrop {
  background: rgb(3 9 21 / 0.65);
  backdrop-filter: blur(6px);
}
.step {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 999px;
  background: rgb(95 176 236 / 0.15);
  color: var(--color-himmel);
  font-weight: 700;
  font-size: 0.8rem;
}
@media (prefers-reduced-motion: no-preference) {
  .install-dialog[open] { animation: sheet-in 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 640px) {
  .install-dialog[open] { animation-name: pop-in; }
}
@keyframes sheet-in { from { transform: translateY(100%); } }
@keyframes pop-in { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
</style>
