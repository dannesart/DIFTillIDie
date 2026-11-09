<script setup lang="ts">
import { SIXTY_MINUTES } from '~/lib/matchtips'

/*
 * Matchtipset (lib/matchtips, docs/matchtipset.md): the pilot's rules, your
 * participation, the real verified matches, and the season table. Guests get
 * an invitation and nothing else; joining is a deliberate click on a consent
 * card, never a side effect of visiting. Everything shown comes from the
 * database; when there's nothing yet, it says so.
 */
const { status: authStatus, profile, profileStatus } = useAuth()
const accountOpen = useAccountDialog()
const { edit: editProfile } = useProfileEditor()
const tips = useMatchtips()
const { status, participating, optedInAt, consentVersion, matches, myPicks, standings, picks, joining, leaving, saving, notes, error } = tips

// The deadline is the database's; the clock only closes a form whose time has come.
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void tips.load()
  tick = setInterval(() => (now.value = Date.now()), 15_000)
})
onBeforeUnmount(() => clearInterval(tick))

const signedOut = computed(() => authStatus.value === 'signed-out' || authStatus.value === 'unavailable')
const loading = computed(() => !signedOut.value && (authStatus.value === 'loading' || status.value === 'idle' || status.value === 'loading'))
const since = computed(() => (optedInAt.value ? new Date(optedInAt.value).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', timeZone: 'Europe/Stockholm' }) : null))

const leaveOpen = ref(false)
const removed = ref<number | null>(null)
async function leave() {
  const n = await tips.leave()
  if (n === null) return
  removed.value = n
  leaveOpen.value = false
}
async function join() {
  removed.value = null
  await tips.join()
}
</script>

<template>
  <!-- A size container: the match grid follows the space the shell leaves, not the window -->
  <div class="@container space-y-6">
    <header>
      <p class="kicker text-himmel">Pilot · SHL 2026/27 · Djurgården herr</p>
      <h1 class="section-title mt-2">Matchtipset</h1>
      <p class="mt-3 max-w-xl text-krita-dim">
        Tippa Djurgårdens matcher i SHL och jämför med andra supportrar. Bara riktiga matcher, verifierade mot klubbens och ligans egna sidor. Inga pengar, inga priser.
      </p>
    </header>

    <!-- The rules, for everyone: the scoring always, the details on request on a phone -->
    <MatchtipsetRules />

    <!-- Guests: an invitation, nothing else -->
    <section v-if="signedOut" class="card px-6 py-10 text-center">
      <div class="stripes mx-auto h-12 w-9 rounded-md [--stripe:6px]" aria-hidden="true" />
      <h2 class="mt-5 font-display text-2xl font-bold">Logga in för att vara med</h2>
      <p class="mx-auto mt-2 max-w-md text-krita-dim">Matchtipset är för inloggade supportrar. Du loggar in med en kod som vi mejlar dig.</p>
      <button v-if="authStatus === 'signed-out'" class="mt-6 rounded-full bg-guld px-6 py-3 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" aria-haspopup="dialog" @click="accountOpen = true">Logga in</button>
      <p v-else class="mt-4 text-sm text-krita-dim">Inloggning är inte tillgänglig här just nu.</p>
    </section>

    <div v-else-if="loading" class="card space-y-3 p-6" aria-busy="true" aria-live="polite">
      <div class="h-6 w-40 rounded-full bg-white/8" />
      <div class="h-4 w-64 rounded-full bg-white/5" />
      <div class="h-24 rounded-2xl bg-white/[0.04]" />
      <span class="sr-only">Hämtar Matchtipset…</span>
    </div>

    <section v-else-if="status === 'unavailable'" class="card px-6 py-10 text-center">
      <h2 class="font-display text-2xl font-bold">Matchtipset är inte igång här</h2>
      <p class="mx-auto mt-2 max-w-md text-krita-dim">Databasen bakom den här sidan har inte Matchtipset ännu.</p>
    </section>

    <section v-else-if="status === 'error'" class="card px-6 py-10 text-center" role="alert">
      <h2 class="font-display text-2xl font-bold">Det gick inte att hämta Matchtipset</h2>
      <p class="mx-auto mt-2 max-w-md text-krita-dim">{{ error }}</p>
      <button class="mt-6 rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold transition hover:border-himmel hover:text-himmel" @click="tips.load()">Försök igen</button>
    </section>

    <template v-else>
      <p v-if="removed !== null" class="rounded-2xl border border-himmel/30 bg-himmel/10 px-4 py-3 text-sm" role="status">
        Du har lämnat Matchtipset. {{ removed === 1 ? '1 tips raderades' : `${removed} tips raderades` }}, och du syns inte längre i tabellen. Ditt konto finns kvar.
      </p>

      <!-- Taking part: a deliberate choice, with what it means spelled out -->
      <section v-if="!participating" class="card p-5 sm:p-6" aria-labelledby="mt-join">
        <h2 id="mt-join" class="font-display text-xl font-bold">Vill du vara med?</h2>
        <ul class="mt-3 max-w-prose space-y-2 text-sm">
          <li v-if="profile">Ditt läktarnamn <strong>@{{ profile.handle }}</strong> syns i tabellen för andra inloggade supportrar.</li>
          <li>Ditt tips syns bara för dig fram till deadline. Efter deadline ser inloggade supportrar tipset som gäller – aldrig dina tidigare versioner.</li>
          <li>{{ SIXTY_MINUTES }}</li>
          <li>Du kan lämna när du vill. Då raderas alla dina tips och du försvinner ur tabellen. Ditt konto finns kvar.</li>
        </ul>
        <p v-if="error" class="mt-3 text-sm text-rod" role="alert">{{ error }}</p>
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <button
            v-if="profile"
            class="rounded-full bg-guld px-6 py-3 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60"
            :disabled="joining || !consentVersion"
            @click="join"
          >
            {{ joining ? 'Går med…' : 'Gå med i Matchtipset' }}
          </button>
          <template v-else-if="profileStatus === 'missing'">
            <p class="text-sm text-krita-dim">Först behöver du ett läktarnamn – det är det som syns i tabellen.</p>
            <button class="rounded-full bg-guld px-6 py-3 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" aria-haspopup="dialog" @click="editProfile()">Välj läktarnamn</button>
          </template>
          <span v-if="consentVersion" class="text-xs text-krita-dim">Villkorsversion {{ consentVersion }}</span>
        </div>
      </section>

      <p v-else class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-krita-dim">
        <span>Du är med<template v-if="profile"> som <strong class="text-krita">@{{ profile.handle }}</strong></template><template v-if="since"> sedan {{ since }}</template>.</span>
        <button class="font-semibold text-krita-dim underline decoration-white/30 underline-offset-4 hover:text-krita" aria-haspopup="dialog" @click="leaveOpen = true">Lämna Matchtipset</button>
      </p>

      <!-- The matches: real and verified, or honestly none -->
      <section aria-labelledby="mt-matches">
        <h2 id="mt-matches" class="font-display text-2xl font-bold">Matcher</h2>
        <div v-if="!matches.length" class="card mt-3 px-6 py-8 text-center">
          <p class="font-semibold">Inga matcher att tippa ännu</p>
          <p class="mx-auto mt-2 max-w-md text-sm text-krita-dim">Piloten har inte startat. När den gör det lägger vi in nästa riktiga match här, kontrollerad mot det officiella spelschemat.</p>
        </div>
        <!-- Two columns once the middle is wide enough, and there's more than one match -->
        <ul v-else class="mt-3 grid items-start gap-4" :class="matches.length > 1 && '@4xl:grid-cols-2'">
          <li v-for="m in matches" :key="m.id">
            <MatchtipsetMatch
              :match="m"
              :mine="myPicks[m.id] ?? null"
              :participating="participating"
              :now="now"
              :saving="saving === m.id"
              :note="notes[m.id] ?? null"
              :picks="picks[m.id] ?? null"
              :own-handle="profile?.handle ?? null"
              @submit="(h, a) => tips.submit(m.id, h, a)"
              @show-picks="tips.loadPicks(m.id)"
            />
          </li>
        </ul>
      </section>

      <MatchtipsetBoard :standings="standings" :own-handle="participating ? profile?.handle ?? null : null" />
    </template>

    <MatchtipsetLeave v-model:open="leaveOpen" :leaving="leaving" :error="participating ? error : null" @confirm="leave" />
  </div>
</template>
