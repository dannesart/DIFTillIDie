<script setup lang="ts">
/*
 * Easter egg: type D-I-F anywhere (or press the heart in the footer)
 * and a tifo of stripes sweeps across the screen.
 */
const burst = useState('stripe-burst', () => 0)
const active = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

watch(burst, () => {
  active.value = false
  clearTimeout(timer)
  requestAnimationFrame(() => {
    active.value = true
    timer = setTimeout(() => (active.value = false), 2200)
  })
})

let typed = ''
function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, select, [contenteditable]')) return
  typed = (typed + e.key.toLowerCase()).slice(-3)
  if (typed === 'dif') burst.value++
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(timer)
})
</script>

<template>
  <div v-if="active" class="pointer-events-none fixed inset-0 z-[100] overflow-hidden" aria-hidden="true">
    <div class="tifo absolute inset-y-0 -left-[200%] flex w-[200%]">
      <span v-for="i in 24" :key="i" class="h-full flex-1" :class="i % 2 ? 'bg-himmel' : 'bg-navy-800'" :style="{ animationDelay: `${i * 18}ms` }" />
    </div>
    <p class="shout absolute inset-0 grid place-items-center font-display text-[clamp(3rem,14vw,11rem)] font-black italic text-krita drop-shadow-[0_8px_40px_rgb(3_9_21/0.8)]">
      Djurgår’n!
    </p>
  </div>
</template>

<style scoped>
.tifo {
  animation: sweep 2.2s cubic-bezier(0.7, 0, 0.3, 1) forwards;
}
.tifo span {
  transform-origin: bottom;
  animation: wave 2.2s ease-in-out both;
}
.shout {
  animation: shout 2.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes sweep {
  0% { transform: translateX(0); }
  100% { transform: translateX(150%); }
}
@keyframes wave {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.92); }
}
@keyframes shout {
  0% { opacity: 0; transform: scale(0.6) rotate(-6deg); }
  25%, 70% { opacity: 1; transform: scale(1) rotate(-3deg); }
  100% { opacity: 0; transform: scale(1.1) rotate(-3deg); }
}
</style>
