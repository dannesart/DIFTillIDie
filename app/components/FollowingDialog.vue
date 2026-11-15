<script setup lang="ts">
/*
 * "Du följer": the supporters you follow, in a dialog opened from the
 * "Följer" number on your own läktarplats (SupporterPlace). Private: only
 * you, on your own place, can open it. The list is Following v1's own
 * (the follows store's list, from followed_supporters()): only public
 * supporters, newest follow first. Nothing new is fetched or exposed here.
 *
 * Native <dialog> like the account dialog: Escape and the close button close
 * it, focus goes back to what opened it, a centred card on desktop and a
 * bottom sheet on phones.
 */
const open = defineModel<boolean>('open', { required: true })
const follows = useFollows()
const links = useSectionLinks()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
let opener: HTMLElement | null = null

watch(open, (isOpen) => {
  const el = dialog.value
  if (!el) return
  if (isOpen) {
    opener = document.activeElement as HTMLElement | null
    if (!el.open) el.showModal()
    document.documentElement.classList.add('dialog-open')
    // The list as it is now (kept on screen while it's asked for again).
    void follows.loadList()
  }
  else if (el.open) {
    el.close()
  }
})

function onClose() {
  document.documentElement.classList.remove('dialog-open')
  open.value = false
  opener?.focus({ preventScroll: true })
}

// A tap on the backdrop (outside the card) closes it.
function onClick(e: MouseEvent) {
  const el = dialog.value
  if (!el || e.target !== el) return
  const r = el.getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) open.value = false
}

// Going to a supporter: the dialog goes with the page it was on.
function go() {
  opener = null
  open.value = false
}

onBeforeUnmount(() => document.documentElement.classList.remove('dialog-open'))
</script>

<template>
  <dialog ref="dialog" class="following-dialog text-krita" aria-labelledby="i-follow" @close="onClose" @click="onClick">
    <div class="stripes h-1.5 [--stripe:10px]" aria-hidden="true" />
    <div class="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
    <div class="px-5 pb-6 pt-3 sm:px-7 sm:pb-7 sm:pt-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 id="i-follow" class="font-display text-3xl font-bold leading-tight">Du följer</h2>
          <p class="mt-1 text-xs text-krita-dim">Bara du ser vilka du följer.</p>
        </div>
        <button type="button" class="grid size-9 shrink-0 place-items-center rounded-full text-krita-dim hover:bg-white/10 hover:text-krita" aria-label="Stäng" @click="open = false">
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <ul v-if="(follows.listStatus.value === 'loading' || follows.listStatus.value === 'idle') && !follows.list.value.length" class="mt-4 space-y-2" aria-busy="true" aria-label="Hämtar vilka du följer">
        <li v-for="n in 2" :key="n" class="h-14 animate-pulse rounded-2xl bg-white/[0.03]" />
      </ul>
      <p v-else-if="follows.listStatus.value === 'error'" class="mt-4 text-sm text-krita-dim" role="alert">
        Kunde inte hämta vilka du följer.
        <button type="button" class="font-semibold text-himmel hover:underline" @click="follows.loadList()">Försök igen</button>
      </p>
      <p v-else-if="follows.listStatus.value === 'unavailable'" class="mt-4 text-sm text-krita-dim">
        Att följa supportrar går inte att använda här än.
      </p>
      <ul v-else-if="follows.list.value.length" class="mt-3 max-h-[60dvh] divide-y divide-white/6 overflow-y-auto overscroll-contain">
        <li v-for="p in follows.list.value" :key="p.id">
          <NuxtLink :to="links.supporter(p.handle)" class="group flex items-center gap-3 py-2.5" @click="go">
            <Avatar :name="p.name" :design="p.avatar" size="md" />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold group-hover:text-himmel">{{ p.name }}</span>
              <span class="block truncate text-sm text-krita-dim">@{{ p.handle }}</span>
            </span>
            <span class="text-krita-dim transition group-hover:translate-x-1 group-hover:text-himmel" aria-hidden="true">→</span>
          </NuxtLink>
        </li>
      </ul>
      <p v-else class="mt-3 text-sm leading-relaxed text-krita-dim">
        Du följer ingen än. Tryck på ett namn i
        <NuxtLink :to="links.section('snacket')" class="font-semibold text-himmel hover:underline" @click="go">Snacket</NuxtLink>
        och välj <span class="font-semibold text-krita">Följ</span>, så hittar du tillbaka till dem här.
      </p>
    </div>
  </dialog>
</template>

<style scoped>
.following-dialog {
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
  .following-dialog {
    inset: 0;
    margin: auto;
    width: min(28rem, calc(100% - 3rem));
    height: fit-content;
    padding: 0;
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 1.75rem;
  }
}
.following-dialog::backdrop {
  background: rgb(3 9 21 / 0.65);
  backdrop-filter: blur(6px);
}
@media (prefers-reduced-motion: no-preference) {
  .following-dialog[open] { animation: sheet-in 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 640px) {
  .following-dialog[open] { animation-name: pop-in; }
}
@keyframes sheet-in { from { transform: translateY(100%); } }
@keyframes pop-in { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
</style>
