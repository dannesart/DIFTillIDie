<script setup lang="ts">
import type { Fixture } from '#shared/types/domain'

const demoNow = useDemoNow()
const now = useNow()
const { data } = useFixtures()
const { sport } = useSport()

// Server render and first client paint use the same instant; then the live clock takes over.
const clockNow = computed(() => now.value ?? demoNow.value)
const fixture = computed(() => nextFixture(data.value?.fixtures ?? [], clockNow.value, sport.value))

const left = computed(() => (fixture.value ? countdown(fixture.value.kickoff, clockNow.value) : null))
const units = computed(() => [
  { label: 'dagar', value: left.value?.dagar ?? 0 },
  { label: 'tim', value: left.value?.timmar ?? 0 },
  { label: 'min', value: left.value?.minuter ?? 0 },
  { label: 'sek', value: now.value ? (left.value?.sekunder ?? 0) : null },
])

const sportLabel = { fotboll: 'Fotboll', hockey: 'Hockey' } as const
const isDif = (name: string) => /^djurg[aå]rden/i.test(name)

// What we follow, said out loud — nothing silently left out.
const scope = computed(() => data.value?.scope ?? [])
const covered = computed(() => scope.value.filter(s => s.coverage !== 'none' && (sport.value === 'alla' || s.sport === sport.value)))
const uncovered = computed(() => scope.value.filter(s => s.coverage === 'none' && (sport.value === 'alla' || s.sport === sport.value)))

function verifiedLabel(f: Fixture) {
  if (!f.verifiedAt) return 'Manuellt verifierad'
  const d = new Date(`${f.verifiedAt}T12:00:00Z`)
  return `Verifierad ${new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' }).format(d).replace('.', '')}`
}

// "fredag 6 november" → "Fredag 6 november" (Swedish months stay lowercase).
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

function downloadIcs() {
  const f = fixture.value
  if (!f) return
  const url = URL.createObjectURL(new Blob([fixtureIcs(f)], { type: 'text/calendar;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${slug(f.home)}-${slug(f.away)}-${f.kickoff.slice(0, 10)}.ics` })
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="card grain relative overflow-hidden p-6 sm:p-7">
    <div class="stripes absolute inset-x-0 top-0 h-1.5 [--stripe:10px]" />

    <Transition mode="out-in" enter-from-class="opacity-0 motion-safe:translate-y-2" leave-to-class="opacity-0 motion-safe:-translate-y-2" enter-active-class="transition duration-300" leave-active-class="transition duration-200">
      <div v-if="fixture" :key="fixture.id">
        <div class="flex items-center justify-between gap-3">
          <p class="kicker truncate text-krita-dim">Nästa match<span class="hidden sm:inline"> · {{ sportLabel[fixture.sport] }}</span></p>
          <span
            v-if="fixture.source === 'manual'"
            class="kicker shrink-0 rounded-full border border-guld/40 px-2 py-0.5 text-guld"
            title="Inmatad för hand efter kontroll mot klubbens officiella spelschema – inte automatiskt synkad."
          >{{ verifiedLabel(fixture) }}</span>
          <span
            v-else
            class="kicker flex shrink-0 items-center gap-1.5 rounded-full border border-himmel/40 px-2 py-0.5 text-himmel"
            title="Hämtad automatiskt från Djurgårdens officiella matchkalender på dif.se."
          ><span class="size-1.5 rounded-full bg-himmel" />dif.se</span>
        </div>

        <p class="kicker mt-5 text-krita-dim">{{ fixture.competition }} · {{ teamLabel(fixture) }}</p>
        <p class="mt-1.5 font-display text-3xl font-bold leading-tight sm:text-4xl">
          <span :class="isDif(fixture.home) && 'text-himmel-300'">{{ fixture.home }}</span>
          <span class="font-normal italic text-krita-dim"> – </span>
          <span :class="isDif(fixture.away) && 'text-himmel-300'">{{ fixture.away }}</span>
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-krita-dim">
          <span v-if="isAway(fixture)" class="inline-flex items-center gap-1.5 rounded-full bg-guld/12 px-2.5 py-1 text-xs font-semibold text-guld">
            <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19 10 5M20 19 14 5M12 7v2M12 12v2M12 17v2" /></svg>
            På bortaplan
          </span>
          <span v-else class="inline-flex items-center gap-1.5 rounded-full bg-himmel/12 px-2.5 py-1 text-xs font-semibold text-himmel">
            <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11 12 4l8 7M6 10v9h12v-9" /></svg>
            Hemma
          </span>
          <span v-if="fixture.venue">{{ fixture.venue }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ upperFirst(kickoffLabel(fixture.kickoff)) }}</span>
          <span v-if="fixture.preliminary" class="rounded-full border border-rod/50 px-2 py-0.5 text-xs font-semibold text-rod">Preliminär tid</span>
        </div>

        <div class="mt-6 grid grid-cols-4 gap-2" aria-live="off">
          <div v-for="u in units" :key="u.label" class="rounded-2xl bg-navy-950/70 px-2 py-3 text-center">
            <span class="block font-display text-3xl font-bold tabular-nums sm:text-4xl">{{ u.value === null ? '··' : String(u.value).padStart(2, '0') }}</span>
            <span class="kicker text-krita-dim">{{ u.label }}</span>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap gap-2">
          <button class="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/12 px-4 py-3 text-sm font-semibold transition hover:border-himmel hover:text-himmel" @click="downloadIcs">
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            Lägg i kalendern
          </button>
          <a :href="fixture.officialUrl" target="_blank" rel="noopener" class="flex items-center justify-center gap-1 rounded-full border border-white/12 px-4 py-3 text-sm font-semibold transition hover:border-himmel hover:text-himmel">
            Matchinfo <span aria-hidden="true">↗</span>
          </a>
          <a v-if="fixture.ticketsUrl && isAway(fixture)" :href="fixture.ticketsUrl" target="_blank" rel="noopener" class="flex items-center justify-center gap-1 rounded-full border border-guld/40 px-4 py-3 text-sm font-semibold text-guld transition hover:border-guld hover:bg-guld/10">
            Bortabiljetter <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <!-- Nothing verified to count down to: say so, beautifully, instead of guessing -->
      <div v-else :key="`tom-${sport}`" class="py-2">
        <p class="kicker text-krita-dim">Nästa match<template v-if="sport !== 'alla'"> · {{ sportLabel[sport] }}</template></p>
        <p class="mt-5 font-display text-3xl font-bold leading-tight sm:text-4xl">
          Ingen verifierad match <span class="font-normal italic text-krita-dim">i sikte</span>
        </p>
        <p class="mt-3 text-sm leading-relaxed text-krita-dim">
          Vi räknar bara ner till matcher vi kan bekräfta hos klubben. Hellre en tom läktare än en påhittad avspark.
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <a v-if="sport !== 'hockey'" href="https://www.dif.se/matcher" target="_blank" rel="noopener" class="chip border-white/12 hover:border-himmel hover:text-himmel">Fotboll på dif.se ↗</a>
          <a v-if="sport !== 'fotboll'" href="https://www.difhockey.se/game-schedule" target="_blank" rel="noopener" class="chip border-white/12 hover:border-himmel hover:text-himmel">Hockey på difhockey.se ↗</a>
        </div>
      </div>
    </Transition>

    <!-- Team scope, stated plainly -->
    <p v-if="scope.length" class="mt-5 border-t border-white/8 pt-4 text-xs leading-relaxed text-krita-dim">
      Bevakar seniorlagen:
      <template v-for="(s, i) in covered" :key="s.label">
        <span class="text-krita">{{ s.label }}</span><span v-if="s.coverage === 'manual'"> (manuellt verifierat)</span><template v-if="i < covered.length - 1">, </template>
      </template>.
      <template v-if="uncovered.length">
        Inget verifierat schema ännu för {{ uncovered.map(s => s.label).join(', ') }}.
      </template>
      <template v-if="data?.status && !data.status.ok">
        Klubbens kalender nås inte just nu<template v-if="data.status.stale"> – visar senast hämtade</template>.
      </template>
    </p>
  </div>
</template>
