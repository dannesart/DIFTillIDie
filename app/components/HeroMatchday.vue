<script setup lang="ts">
const demoNow = useDemoNow()
const now = useNow()

const part = computed(() => dayPart(now.value ?? demoNow.value))
const greeting = computed(() => ({
  morgon: 'God morgon, Djurgårdare',
  dag: 'Hej, Djurgårdare',
  kvall: 'God kväll, Djurgårdare',
  natt: 'Sent ute, Djurgårdare?',
})[part.value])

const days = computed(() => daysSinceFounding(now.value ?? demoNow.value).toLocaleString('sv-SE'))
</script>

<template>
  <section id="hem" class="relative isolate scroll-mt-20 overflow-hidden">
    <!-- Night sky, only after dark -->
    <div v-if="part === 'natt'" aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10">
      <span
        v-for="i in 40"
        :key="i"
        class="absolute size-[2px] rounded-full bg-himmel-200"
        :style="{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 70}%`, animation: `twinkle ${2 + (i % 5)}s ease-in-out ${i % 3}s infinite` }"
      />
    </div>

    <!-- Tifo stripes -->
    <div aria-hidden="true" class="grain absolute -right-24 top-10 -z-10 hidden h-[34rem] w-[30rem] rotate-[8deg] overflow-hidden rounded-[3rem] opacity-90 lg:block">
      <div class="stripes absolute inset-0 [--stripe:38px]" />
      <div class="absolute inset-0 bg-gradient-to-l from-transparent via-navy-950/30 to-navy-950" />
    </div>

    <!-- One column on phones that never grows past the screen (minmax(0,1fr)), whatever is in it (Issue #16) -->
    <div class="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.25fr_1fr] lg:gap-16 lg:pb-24 lg:pt-20">
      <div class="@container animate-rise">
        <p class="kicker flex items-center gap-2 text-himmel">
          <span class="inline-block size-1.5 rounded-full bg-guld" />
          {{ greeting }}
        </p>
        <h1 class="mt-5 font-display font-black leading-[0.82] tracking-[-0.035em]">
          <!-- One unbreakable word, about 5em wide: as large as before, but never wider than its column (19cqi), so a small screen or larger text can't push it off the edge -->
          <span class="stripe-text block text-[min(clamp(4rem,15vw,9.5rem),19cqi)]">Djurgår’n</span>
          <span class="mt-2 block text-[clamp(2.4rem,8vw,5.2rem)] font-semibold italic text-krita">
            tills jag dör<span class="text-rod">.</span>
          </span>
        </h1>
        <p class="mt-7 max-w-lg text-lg leading-relaxed text-krita-dim">
          Fotboll och hockey. Nyheter där källorna får behålla sina egna rubriker, snack från läktaren och poddar
          för långa kvällar. Ett hem för oss som bär randigt.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="#snacket" class="rounded-full bg-krita px-5 py-3 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5 hover:bg-white">
            Gå in i snacket
          </a>
          <a href="#stories" class="rounded-full border border-white/15 px-5 py-3 text-sm font-bold transition hover:-translate-y-0.5 hover:border-himmel hover:text-himmel">
            Senaste stories
          </a>
        </div>
      </div>

      <!-- Next match -->
      <aside class="animate-rise self-end [animation-delay:120ms]">
        <MatchCard />

        <p class="mt-4 px-2 text-sm text-krita-dim">
          Djurgården har funnits i <span class="font-display text-base font-bold text-krita tabular-nums">{{ days }}</span> dagar.
          <span class="italic">Sedan 12 mars 1891.</span>
        </p>
      </aside>
    </div>
  </section>
</template>
