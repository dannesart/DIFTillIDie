<script setup lang="ts">
import type { Fixture } from '~/data/fixtures'

const demoNow = useDemoNow()
const now = useNow()
const fixtures = useFixtures()
const { sport } = useSport()

const part = computed(() => dayPart(now.value ?? demoNow.value))
const greeting = computed(() => ({
  morgon: 'God morgon, Djurgårdare',
  dag: 'Hej, Djurgårdare',
  kvall: 'God kväll, Djurgårdare',
  natt: 'Sent ute, Djurgårdare?',
})[part.value])

const fixture = computed<Fixture>(() => {
  const list = fixtures.value.filter(f => sport.value === 'alla' || f.sport === sport.value)
  return [...list].sort((a, b) => a.kickoff.localeCompare(b.kickoff))[0]!
})

const left = computed(() => countdown(fixture.value.kickoff, now.value ?? demoNow.value))
const units = computed(() => [
  { label: 'dagar', value: left.value.dagar },
  { label: 'tim', value: left.value.timmar },
  { label: 'min', value: left.value.minuter },
  { label: 'sek', value: now.value ? left.value.sekunder : null },
])

const days = computed(() => daysSinceFounding(now.value ?? demoNow.value).toLocaleString('sv-SE'))

/** A real, working reminder: a calendar file for the (demo) match. */
function downloadIcs() {
  const f = fixture.value
  const start = new Date(f.kickoff)
  const end = new Date(start.getTime() + 2 * 3_600_000)
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Djurgarn tills jag dor//SV',
    'BEGIN:VEVENT',
    `UID:${f.sport}-${stamp(start)}@djurgarn`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:Djurgården – ${f.opponent} (${f.competition}) [DEMO]`,
    `LOCATION:${f.venue}`,
    'DESCRIPTION:Demomatch från Djurgår\'n tills jag dör. Kontrollera alltid tider hos klubben.',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `djurgarden-${f.opponent.toLowerCase()}.ics` })
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="relative isolate overflow-hidden">
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

    <div class="mx-auto grid max-w-7xl gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.25fr_1fr] lg:gap-16 lg:pb-24 lg:pt-20">
      <div class="animate-rise">
        <p class="kicker flex items-center gap-2 text-himmel">
          <span class="inline-block size-1.5 rounded-full bg-guld" />
          {{ greeting }}
        </p>
        <h1 class="mt-5 font-display font-black leading-[0.82] tracking-[-0.035em]">
          <span class="stripe-text block text-[clamp(4rem,15vw,9.5rem)]">Djurgår’n</span>
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
        <div class="card grain relative overflow-hidden p-6 sm:p-7">
          <div class="stripes absolute inset-x-0 top-0 h-1.5 [--stripe:10px]" />
          <div class="flex items-center justify-between">
            <p class="kicker text-krita-dim">Nästa match · {{ fixture.sport }}</p>
            <span class="kicker rounded-full border border-guld/40 px-2 py-0.5 text-guld">Demomatch</span>
          </div>

          <Transition mode="out-in" enter-from-class="opacity-0 translate-y-2" leave-to-class="opacity-0 -translate-y-2" enter-active-class="transition duration-300" leave-active-class="transition duration-200">
            <div :key="fixture.sport" class="mt-5">
              <p class="font-display text-3xl font-bold leading-tight sm:text-4xl">
                Djurgården <span class="font-normal italic text-krita-dim">mot</span> {{ fixture.opponent }}
              </p>
              <p class="mt-2 text-sm text-krita-dim">
                {{ fixture.competition }} · {{ fixture.venue }} · <span class="capitalize">{{ kickoffLabel(fixture.kickoff) }}</span>
              </p>
            </div>
          </Transition>

          <div class="mt-6 grid grid-cols-4 gap-2" aria-live="off">
            <div v-for="u in units" :key="u.label" class="rounded-2xl bg-navy-950/70 px-2 py-3 text-center">
              <span class="block font-display text-3xl font-bold tabular-nums sm:text-4xl">{{ u.value === null ? '··' : String(u.value).padStart(2, '0') }}</span>
              <span class="kicker text-krita-dim">{{ u.label }}</span>
            </div>
          </div>

          <button class="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-white/12 py-3 text-sm font-semibold transition hover:border-himmel hover:text-himmel" @click="downloadIcs">
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            Lägg i kalendern
          </button>
        </div>

        <p class="mt-4 px-2 text-sm text-krita-dim">
          Djurgården har funnits i <span class="font-display text-base font-bold text-krita tabular-nums">{{ days }}</span> dagar.
          <span class="italic">Sedan 12 mars 1891.</span>
        </p>
      </aside>
    </div>
  </section>
</template>
