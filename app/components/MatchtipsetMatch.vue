<script setup lang="ts">
import type { MyPick, PublicPick, TipMatch } from '~/lib/matchtips'
import { decidedLabel, formatWhen, lateNote, matchPhase, MAX_GOALS, pointsLabel, score, SIXTY_MINUTES } from '~/lib/matchtips'

/*
 * One Matchtipset match: home first, as officially listed. The deadline
 * shown is the database's. Before it, only your own tip; after it, everyone's
 * effective tips on request, and the verified 60-minute result once there
 * is one. Paused, postponed, corrected and struck matches say so plainly.
 */
const props = defineProps<{
  match: TipMatch
  mine: MyPick | null
  participating: boolean
  now: number
  saving: boolean
  note: { ok: boolean, text: string } | null
  picks: PublicPick[] | 'loading' | 'error' | null
  ownHandle: string | null
}>()
const emit = defineEmits<{ submit: [home: string, away: string], showPicks: [] }>()

const phase = computed(() => matchPhase(props.match, props.now))
const home = ref(props.mine?.latest ? String(props.mine.latest.home) : '')
const away = ref(props.mine?.latest ? String(props.mine.latest.away) : '')
watch(() => props.mine?.latest, (l) => {
  if (!l) return
  home.value = String(l.home)
  away.value = String(l.away)
})
const late = computed(() => (props.mine ? lateNote(props.mine, props.match) : null))
const id = computed(() => `mt-${props.match.id.slice(0, 8)}`)
const badge = computed(() => ({
  open: { text: 'Öppen för tips', cls: 'bg-himmel/15 text-himmel' },
  paused: { text: 'Uppskjuten – pausad', cls: 'bg-guld/15 text-guld' },
  locked: { text: 'Låst – väntar på resultat', cls: 'bg-white/8 text-krita-dim' },
  postponed: { text: 'Uppskjuten – tipsen är låsta', cls: 'bg-guld/15 text-guld' },
  settled: { text: 'Klar', cls: 'bg-white/8 text-krita' },
  void: { text: 'Struken', cls: 'bg-rod/15 text-rod' },
})[phase.value])
const revealed = computed(() => ['locked', 'postponed', 'settled'].includes(phase.value))
</script>

<template>
  <article class="card p-5 sm:p-6" :aria-labelledby="`${id}-title`">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="kicker text-krita-dim">SHL · {{ formatWhen(match.scheduledStart) }}</span>
      <span class="rounded-full px-3 py-1 text-xs font-bold" :class="badge.cls">{{ badge.text }}</span>
    </div>

    <h3 :id="`${id}-title`" class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center font-display text-lg font-bold sm:text-xl">
      <span>{{ match.homeTeam }}<span class="mt-0.5 block font-sans text-[0.7rem] font-semibold uppercase tracking-wider text-krita-dim">Hemma</span></span>
      <span class="text-krita-dim" aria-hidden="true">–</span>
      <span>{{ match.awayTeam }}<span class="mt-0.5 block font-sans text-[0.7rem] font-semibold uppercase tracking-wider text-krita-dim">Borta</span></span>
    </h3>

    <!-- The deadline: the database's, never the MatchCard's -->
    <p v-if="match.locksAt && phase === 'open'" class="mt-3 text-center text-sm">Tippa senast <strong>{{ formatWhen(match.locksAt) }}</strong> (nedsläpp)</p>
    <p v-else-if="match.locksAt && match.status !== 'void'" class="mt-3 text-center text-sm text-krita-dim">Deadline var {{ formatWhen(match.locksAt) }}</p>

    <p v-if="match.deadlineCorrection" class="mt-3 rounded-2xl border border-guld/30 bg-guld/10 px-4 py-3 text-sm">
      <strong>Deadline rättad.</strong> {{ match.deadlineCorrection.reason }}
      <a v-if="match.deadlineCorrection.sourceUrl" :href="match.deadlineCorrection.sourceUrl" target="_blank" rel="noopener" class="font-semibold text-himmel underline-offset-4 hover:underline">Källa ↗</a>
    </p>

    <p v-if="phase === 'paused'" class="mt-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
      Matchen är uppskjuten och har inget nytt datum än. Tippningen är pausad och inga tips visas. När ett nytt datum är klart öppnar den igen, med nedsläppet som ny deadline.
    </p>
    <p v-else-if="phase === 'postponed'" class="mt-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
      Matchen är uppskjuten efter deadline. Tipsen är låsta och står kvar tills matchen spelas.
    </p>
    <p v-else-if="phase === 'void'" class="mt-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
      Struken<template v-if="match.voidReason">: {{ match.voidReason }}</template>. Matchen ger inga poäng och räknas inte.
    </p>
    <p v-else-if="phase === 'locked' && Date.parse(match.scheduledStart) > Date.parse(match.locksAt ?? match.scheduledStart)" class="mt-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
      Matchen spelas {{ formatWhen(match.scheduledStart) }}. Tipsen låstes vid den ursprungliga deadlinen och står kvar.
    </p>

    <!-- The verified 60-minute result -->
    <div v-if="match.result && match.status !== 'void'" class="mt-4 rounded-2xl bg-white/[0.04] px-4 py-3 text-center">
      <p class="kicker text-krita-dim">Efter 60 minuter</p>
      <p class="font-display text-3xl font-bold">{{ score(match.result) }}</p>
      <p class="text-sm text-krita-dim">{{ decidedLabel(match.result.decidedIn) }}</p>
      <p v-if="match.result.revision > 1" class="mt-1 text-sm text-guld">Resultatet har rättats<template v-if="match.result.note"> – {{ match.result.note }}</template></p>
      <a v-if="match.result.sourceUrl" :href="match.result.sourceUrl" target="_blank" rel="noopener" class="mt-1 inline-block text-xs font-semibold text-himmel underline-offset-4 hover:underline">Verifierat mot källa ↗</a>
    </div>

    <!-- Your tip -->
    <div v-if="mine && phase !== 'open'" class="mt-4 text-sm">
      <p v-if="mine.pick && phase === 'paused'">Ditt tips står kvar: <strong>{{ score(mine.pick) }}</strong></p>
      <p v-else-if="mine.pick">Ditt tips: <strong>{{ score(mine.pick) }}</strong><template v-if="match.status !== 'void'"> · {{ pointsLabel(phase === 'settled' ? mine.points : null) }}</template></p>
      <p v-if="late" class="mt-2 rounded-2xl border border-white/10 px-4 py-3 text-krita-dim">{{ late }}</p>
    </div>

    <form v-if="phase === 'open' && participating" class="mt-4" :aria-describedby="`${id}-rule`" @submit.prevent="emit('submit', home, away)">
      <p :id="`${id}-rule`" class="text-center text-xs text-krita-dim">{{ SIXTY_MINUTES }}</p>
      <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <label class="text-center text-xs font-semibold text-krita-dim">
          {{ match.homeTeam }} (hemma)
          <input v-model="home" class="mt-1 block w-full rounded-2xl border border-white/15 bg-navy-950 px-3 py-3 text-center font-display text-2xl font-bold text-krita focus:border-himmel focus:outline-none" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" required :aria-label="`Mål för ${match.homeTeam}, hemma, efter 60 minuter`">
        </label>
        <span class="pb-4 font-display text-xl text-krita-dim" aria-hidden="true">–</span>
        <label class="text-center text-xs font-semibold text-krita-dim">
          {{ match.awayTeam }} (borta)
          <input v-model="away" class="mt-1 block w-full rounded-2xl border border-white/15 bg-navy-950 px-3 py-3 text-center font-display text-2xl font-bold text-krita focus:border-himmel focus:outline-none" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" required :aria-label="`Mål för ${match.awayTeam}, borta, efter 60 minuter`">
        </label>
      </div>
      <button type="submit" class="mt-4 w-full rounded-full bg-guld px-6 py-3 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60" :disabled="saving">
        {{ saving ? 'Sparar…' : mine ? 'Ändra tips' : 'Spara tips' }}
      </button>
      <p class="mt-2 text-center text-xs text-krita-dim">Bara du ser ditt tips före deadline. 0–{{ MAX_GOALS }} mål.</p>
    </form>
    <p v-else-if="phase === 'open'" class="mt-4 text-center text-sm text-krita-dim">Gå med i Matchtipset för att tippa den här matchen.</p>
    <p v-if="note" class="mt-3 text-center text-sm" :class="note.ok ? 'text-himmel' : 'text-rod'" :role="note.ok ? 'status' : 'alert'">{{ note.text }}</p>

    <!-- Everyone's tips: only after the deadline, and only the ones that count -->
    <div v-if="revealed" class="mt-4 border-t border-white/8 pt-4">
      <button v-if="picks === null || picks === 'error'" class="text-sm font-semibold text-himmel underline-offset-4 hover:underline" @click="emit('showPicks')">
        {{ picks === 'error' ? 'Kunde inte hämta tipsen – försök igen' : 'Visa allas tips' }}
      </button>
      <p v-else-if="picks === 'loading'" class="text-sm text-krita-dim" aria-live="polite">Hämtar tipsen…</p>
      <p v-else-if="!picks.length" class="text-sm text-krita-dim">Ingen tippade den här matchen.</p>
      <ul v-else class="divide-y divide-white/5 text-sm">
        <li v-for="p in picks" :key="p.handle" class="flex items-center justify-between gap-3 py-2" :class="p.handle === ownHandle && 'font-semibold text-krita'">
          <span class="truncate">@{{ p.handle }}<span v-if="p.handle === ownHandle" class="text-krita-dim"> (du)</span></span>
          <span class="shrink-0 tabular-nums">{{ score(p) }} · <span class="text-krita-dim">{{ pointsLabel(phase === 'settled' ? p.points : null) }}</span></span>
        </li>
      </ul>
    </div>
  </article>
</template>
