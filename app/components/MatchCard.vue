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

// What we follow, said out loud — nothing silently left out, but behind a tap.
const scope = computed(() => data.value?.scope ?? [])
const coverageText = { automatic: 'Automatiskt från dif.se:s matchkalender', manual: 'Manuellt verifierat mot difhockey.se', none: 'Inget verifierat schema ännu' } as const
const coverageDot = { automatic: 'bg-himmel', manual: 'bg-guld', none: 'bg-white/25' } as const

const infoOpen = ref(false)
const infoPanel = useTemplateRef<HTMLElement>('infoPanel')
let infoTrigger: HTMLElement | null = null

function toggleInfo(e: MouseEvent) {
  infoTrigger = e.currentTarget as HTMLElement
  infoOpen.value = !infoOpen.value
  if (infoOpen.value) nextTick(() => infoPanel.value?.focus())
}
function closeInfo(returnFocus = true) {
  if (!infoOpen.value) return
  infoOpen.value = false
  if (returnFocus) infoTrigger?.focus()
}
function onDocPointer(e: PointerEvent) {
  if (!infoOpen.value) return
  const t = e.target as Node
  if (infoPanel.value?.contains(t) || infoTrigger?.contains(t)) return
  closeInfo(false)
}
onMounted(() => document.addEventListener('pointerdown', onDocPointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer))

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
        <!-- Phones: the badge wraps below rather than cutting "Nästa match" short (larger text, Issue #16); the desktop rail keeps one line -->
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:flex-nowrap">
          <p class="kicker min-w-0 text-krita-dim lg:truncate">Nästa match<span class="hidden sm:inline"> · {{ sportLabel[fixture.sport] }}</span></p>
          <!-- Source stays visible; the badge opens the details -->
          <button
            class="kicker flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-left transition lg:shrink-0"
            :class="fixture.source === 'manual' ? 'border-guld/40 text-guld hover:bg-guld/10' : 'border-himmel/40 text-himmel hover:bg-himmel/10'"
            :aria-expanded="infoOpen"
            aria-controls="match-info"
            :aria-label="fixture.source === 'manual' ? `${verifiedLabel(fixture)} – om matchdatan` : 'Från dif.se – om matchdatan'"
            @click="toggleInfo"
          >
            <span v-if="fixture.source !== 'manual'" class="size-1.5 rounded-full bg-himmel" />
            {{ fixture.source === 'manual' ? verifiedLabel(fixture) : 'dif.se' }}
            <span aria-hidden="true" class="grid size-3.5 place-items-center rounded-full border border-current text-[0.55rem] leading-none">i</span>
          </button>
        </div>

        <p class="kicker mt-5 text-krita-dim">{{ fixture.competition }} · {{ teamLabel(fixture) }}</p>
        <!-- A team name too long for a line of its own (large text on a small phone) breaks instead of running out of the card -->
        <p class="mt-1.5 break-words font-display text-3xl font-bold leading-tight sm:text-4xl">
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

        <!-- Four in a row when they fit (about 14rem, so it grows with larger text); two by two when they don't, rather than overlapping (Issue #16) -->
        <div class="@container mt-6">
          <div class="grid grid-cols-2 gap-2 @[14rem]:grid-cols-4" aria-live="off">
            <div v-for="u in units" :key="u.label" class="rounded-2xl bg-navy-950/70 px-2 py-3 text-center">
              <span class="block font-display text-3xl font-bold tabular-nums sm:text-4xl">{{ u.value === null ? '··' : String(u.value).padStart(2, '0') }}</span>
              <span class="kicker text-krita-dim">{{ u.label }}</span>
            </div>
          </div>
        </div>

        <!-- Compact, one line each; they wrap onto a new row rather than squeeze -->
        <div class="mt-5 flex flex-wrap gap-2">
          <button class="flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/12 px-4 py-2 text-sm font-semibold transition hover:border-himmel hover:text-himmel" aria-label="Lägg i kalendern" @click="downloadIcs">
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            Kalender
          </button>
          <a :href="fixture.officialUrl" target="_blank" rel="noopener" class="flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-white/12 px-4 py-2 text-sm font-semibold transition hover:border-himmel hover:text-himmel">
            Matchinfo <span aria-hidden="true">↗</span>
          </a>
          <a v-if="fixture.ticketsUrl && isAway(fixture)" :href="fixture.ticketsUrl" target="_blank" rel="noopener" class="flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-guld/40 px-4 py-2 text-sm font-semibold text-guld transition hover:border-guld hover:bg-guld/10">
            Bortabiljetter <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <!-- Nothing verified to count down to: say so, beautifully, instead of guessing -->
      <div v-else :key="`tom-${sport}`" class="py-2">
        <div class="flex items-center justify-between gap-3">
          <p class="kicker text-krita-dim">Nästa match<template v-if="sport !== 'alla'"> · {{ sportLabel[sport] }}</template></p>
          <button class="kicker flex items-center gap-1.5 rounded-full border border-white/15 px-2 py-0.5 text-krita-dim transition hover:text-krita" :aria-expanded="infoOpen" aria-controls="match-info" @click="toggleInfo">
            Om matchdatan <span aria-hidden="true" class="grid size-3.5 place-items-center rounded-full border border-current text-[0.55rem] leading-none">i</span>
          </button>
        </div>
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

    <!-- Essential, so always visible: when the club's calendar can't be reached -->
    <p v-if="data?.status && !data.status.ok" class="mt-4 text-xs text-guld">
      Klubbens kalender nås inte just nu<template v-if="data.status.stale"> – visar senast hämtade matcher</template>.
    </p>

    <!-- Coverage & sources, on demand -->
    <Transition enter-from-class="opacity-0 motion-safe:-translate-y-1" leave-to-class="opacity-0" enter-active-class="transition duration-200" leave-active-class="transition duration-150">
      <section
        v-if="infoOpen"
        id="match-info"
        ref="infoPanel"
        tabindex="-1"
        aria-labelledby="match-info-title"
        class="absolute inset-x-3 top-12 z-20 max-h-[calc(100%-4rem)] overflow-y-auto rounded-2xl border border-white/12 bg-navy-950/95 p-5 shadow-[0_24px_60px_-20px_rgb(3_9_21/0.95)] backdrop-blur-xl focus:outline-none"
        @keydown.esc="closeInfo()"
      >
        <div class="flex items-start justify-between gap-3">
          <h3 id="match-info-title" class="font-display text-xl font-semibold">Om matchdatan</h3>
          <button class="grid size-7 shrink-0 place-items-center rounded-full text-krita-dim hover:bg-white/10 hover:text-krita" aria-label="Stäng" @click="closeInfo()">✕</button>
        </div>
        <p class="mt-1 text-xs leading-relaxed text-krita-dim">Vi räknar bara ner till A-lagens matcher som vi kan bekräfta hos klubben. Akademilag ingår inte.</p>
        <ul class="mt-4 space-y-2.5">
          <li v-for="s in scope" :key="s.label" class="flex items-start gap-2.5 text-sm">
            <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="coverageDot[s.coverage]" />
            <span><span class="font-semibold" :class="s.coverage === 'none' && 'text-krita-dim'">{{ s.label }}</span><span class="block text-xs text-krita-dim">{{ coverageText[s.coverage] }}</span></span>
          </li>
        </ul>
        <p class="mt-4 border-t border-white/8 pt-3 text-xs leading-relaxed text-krita-dim">
          Fotbollen hämtas från Djurgårdens officiella kalender och uppdateras löpande.
          Hockeyn finns inte som öppen kalender, så vi för in matcherna för hand efter att ha kontrollerat dem – de är aldrig automatiskt synkade.
        </p>
      </section>
    </Transition>
  </div>
</template>
