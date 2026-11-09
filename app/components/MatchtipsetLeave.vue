<script setup lang="ts">
/*
 * Leaving Matchtipset, confirmed: every tip (all versions) is deleted and
 * you leave the table; the account stays. Native <dialog> like the others:
 * a centred card on desktop, a bottom sheet on phones. "Behåll" has focus,
 * so Enter or Escape never deletes anything by accident.
 */
const open = defineModel<boolean>('open', { required: true })
defineProps<{ leaving: boolean, error: string | null }>()
const emit = defineEmits<{ confirm: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const keep = useTemplateRef<HTMLButtonElement>('keep')
watch(open, (v) => {
  const el = dialog.value
  if (!el) return
  if (v && !el.open) {
    el.showModal()
    keep.value?.focus()
  }
  if (!v && el.open) el.close()
})
</script>

<template>
  <dialog ref="dialog" class="leave-dialog text-krita" aria-labelledby="mt-leave-title" @close="open = false">
    <div class="stripes h-1.5 [--stripe:10px]" aria-hidden="true" />
    <div class="px-5 pb-6 pt-4 sm:px-7 sm:pb-7 sm:pt-5">
      <h2 id="mt-leave-title" class="font-display text-2xl font-bold">Lämna Matchtipset?</h2>
      <ul class="mt-3 space-y-2 text-sm text-krita-dim">
        <li>Alla dina tips raderas, även tidigare versioner och tips på spelade matcher.</li>
        <li>Du försvinner ur tabellen, och andras placeringar kan ändras.</li>
        <li>Ditt konto, ditt läktarnamn och dina inlägg finns kvar.</li>
        <li>Går du med igen börjar du från noll.</li>
      </ul>
      <p v-if="error" class="mt-3 text-sm text-rod" role="alert">{{ error }}</p>
      <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button ref="keep" class="rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold transition hover:border-himmel hover:text-himmel" @click="open = false">Behåll mina tips</button>
        <button class="rounded-full bg-rod px-5 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60" :disabled="leaving" @click="emit('confirm')">
          {{ leaving ? 'Raderar…' : 'Lämna och radera mina tips' }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.leave-dialog {
  position: fixed;
  inset: auto 0 0 0;
  margin: 0;
  width: 100%;
  max-width: 100%;
  padding: 0 0 env(safe-area-inset-bottom);
  border: 1px solid rgb(255 255 255 / 0.1);
  border-bottom: 0;
  border-radius: 1.5rem 1.5rem 0 0;
  background: var(--color-navy-900);
  overflow: hidden;
}
@media (min-width: 640px) {
  .leave-dialog {
    inset: 0;
    margin: auto;
    width: min(28rem, calc(100% - 3rem));
    height: fit-content;
    padding: 0;
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 1.75rem;
  }
}
.leave-dialog::backdrop {
  background: rgb(3 9 21 / 0.65);
  backdrop-filter: blur(6px);
}
</style>
