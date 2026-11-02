<script setup lang="ts">
const burst = useState('stripe-burst', () => 0)
const demoNow = useDemoNow()
const year = computed(() => new Date(demoNow.value).getFullYear())
</script>

<template>
  <footer class="relative overflow-hidden border-t border-white/8 bg-natt pb-12 pt-16">
    <!-- The heartbeat that never stops -->
    <svg aria-hidden="true" viewBox="0 0 1200 120" preserveAspectRatio="none" class="h-20 w-full text-himmel">
      <path
        class="heartbeat"
        d="M0 60 H330 L350 60 L365 20 L382 100 L398 8 L414 84 L428 60 H700 L720 60 L735 26 L752 96 L768 14 L784 80 L798 60 H1200"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <div class="mx-auto mt-10 max-w-7xl px-4 sm:px-6">
      <div class="flex flex-wrap items-end justify-between gap-8">
        <div>
          <p class="font-display text-5xl font-black leading-[0.9] tracking-tight sm:text-7xl">
            Sedan 1891.<br>
            <span class="italic font-semibold text-himmel">Tills jag dör.</span>
          </p>
        </div>
        <button
          class="group flex items-center gap-3 rounded-full border border-white/12 px-5 py-3 text-sm font-semibold transition hover:border-guld hover:text-guld"
          title="Eller skriv D-I-F var som helst på sidan"
          @click="burst++"
        >
          <span class="inline-block transition-transform duration-300 group-hover:scale-125 group-active:scale-90">💙</span>
          Ett hjärta för Djurgår’n
        </button>
      </div>

      <div class="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/8 pt-6 text-xs text-krita-dim">
        <p>© {{ year }} Djurgår’n tills jag dör – ett supporterprojekt, inte en officiell kanal för Djurgårdens IF.</p>
        <p>Nyheter, poddavsnitt och matcher är riktiga och tillhör sina utgivare. Snacket på stan är påhittat.</p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.heartbeat {
  stroke-dasharray: 1600;
  stroke-dashoffset: 1600;
  animation: beat 3.2s linear infinite;
  filter: drop-shadow(0 0 6px rgb(95 176 236 / 0.7));
}
@keyframes beat {
  0% { stroke-dashoffset: 1600; opacity: 1; }
  75% { stroke-dashoffset: 0; opacity: 1; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
</style>
