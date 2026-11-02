<script setup lang="ts">
/*
 * A single, gentle nudge — never a nag. Phones and tablets only, from the
 * third visit, and never again once it has appeared (whatever you choose).
 * Stays out of the way of the podcast mini-player and the keyboard.
 */
const { supported, visits, guideOpen, hintSeen, markHintSeen } = useInstall()
const { current } = usePodcastPlayer()
const typing = useTyping()
const desktop = useMedia('(min-width: 1024px)')

const show = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  // Give the page a moment; then decide once.
  timer = setTimeout(() => {
    if (desktop.value || !supported.value || visits.value < 3 || hintSeen() || current.value) return
    markHintSeen()
    show.value = true
    timer = setTimeout(() => (show.value = false), 15_000)
  }, 4000)
})
onBeforeUnmount(() => clearTimeout(timer))

const visible = computed(() => show.value && !typing.value && !current.value && !guideOpen.value)

function open() {
  show.value = false
  guideOpen.value = true
}
</script>

<template>
  <Transition enter-from-class="opacity-0 motion-safe:translate-y-4" enter-active-class="transition duration-500 ease-out-expo" leave-to-class="opacity-0 motion-safe:translate-y-4" leave-active-class="transition duration-300">
    <aside
      v-if="visible"
      class="fixed inset-x-2 bottom-[calc(var(--nav-h)+0.5rem)] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-navy-900/95 py-2 pl-2 pr-2.5 shadow-[0_24px_60px_-24px_rgb(3_9_21/0.95)] backdrop-blur-xl"
      aria-label="Tips: lägg appen på hemskärmen"
    >
      <img src="/icons/icon-192.png" alt="" width="40" height="40" class="size-10 shrink-0 rounded-xl">
      <p class="min-w-0 flex-1 text-sm leading-snug">
        <span class="font-semibold">Djurgår’n i fickan?</span>
        <span class="block text-xs text-krita-dim">Lägg den på hemskärmen.</span>
      </p>
      <button class="rounded-full bg-guld px-3.5 py-2 text-xs font-bold text-navy-950" @click="open">Visa hur</button>
      <button class="grid size-8 shrink-0 place-items-center rounded-full text-krita-dim hover:bg-white/10 hover:text-krita" aria-label="Nej tack" @click="show = false">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </aside>
  </Transition>
</template>
