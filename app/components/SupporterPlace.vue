<script setup lang="ts">
import { TEAM_INTERESTS } from '#shared/utils/profile'
import type { FeedPost } from '~/composables/useSnacket'
import type { CommunityPost } from '~/lib/posts'

/*
 * A supporter's place on the stands: their name, handle, avatar and bio, and
 * their wall (their own Snacket posts). The address is their handle; a former
 * handle or their user id leads to the same supporter and is replaced by the
 * current handle. Who they are, and whether it's your page, is their user id.
 * Everything is loaded in the browser, like the feed, so the cached HTML is
 * the same empty shell for everyone.
 *
 * The supporter themselves also sees "Mina lag", their private team
 * interests. Nobody else can read them, and nothing is hidden because of them.
 *
 * Used by the shell's view at /laktaren/<handle> (shell/views/Laktaren.vue),
 * which decides the surroundings and keeps one instance per supporter.
 */
const props = defineProps<{ address: string }>()
const route = useRoute()
// The address it was opened with; a different supporter is a different instance.
const address = props.address
const links = useSectionLinks()
const wall = useWall(address)
const { status, profile, posts, total, more, loadingMore, moreError } = wall
const auth = useAuth()
const { userId, profileStatus } = auth
const accountOpen = useAccountDialog()
const editor = useProfileEditor()
const preferences = usePreferences()
const interactions = useInteractions()
// Stories in the feeds right now: posts from before frozen Stories still link to theirs.
useNews()

const own = computed(() => !!userId.value && userId.value === wall.id.value)

// An id, a former handle, or your own handle just changed: show the current address.
watch(wall.canonical, (handle) => {
  if (handle && handle !== address) void navigateTo({ path: links.value.supporter(handle), hash: route.hash }, { replace: true })
})

useSeoMeta({
  title: () => (profile.value ? `${profile.value.displayName} på läktaren – Djurgår’n tills jag dör` : 'På läktaren – Djurgår’n tills jag dör'),
  // Supporters' pages are for the stands, not for search engines.
  robots: 'noindex, nofollow',
})

const feedPosts = computed<FeedPost[]>(() => posts.value.map((p: CommunityPost) => ({
  id: p.id, author: p.author, body: p.body, createdAt: p.createdAt, sport: p.sport, storyId: p.storyId, storyRef: p.storyRef, storyRefInvalid: p.storyRefInvalid, own: own.value,
})))

onMounted(() => void wall.load())
// Signed in or out here: what you may see (your own page before it's public) can change.
watch(userId, () => void wall.load())
// Your own edits show at once.
watch(auth.profile, p => p && wall.showProfile(p))
// Real reactions and comment counts for the posts on the wall.
watch(posts, (list) => {
  const ids = list.map(p => p.id)
  void interactions.loadStats(ids)
  void interactions.loadMine(ids)
})
watch(userId, () => void interactions.loadMine(posts.value.map(p => p.id)))

// Your teams: loaded only on your own page.
watch([own, () => auth.profileStatus.value], ([mine, ps]) => {
  if (mine && ps === 'ready' && preferences.status.value === 'idle') void preferences.load()
}, { immediate: true })

const postsLabel = computed(() => {
  const n = total.value ?? 0
  if (n === 0) return 'Inga inlägg än'
  return `${n} inlägg i Snacket`
})
</script>

<template>
  <!-- Loading: a calm placeholder in the shape of the page -->
  <div v-if="status === 'idle' || status === 'loading'" class="card overflow-hidden" aria-busy="true" aria-live="polite">
    <div class="stripes h-28 opacity-40 [--stripe:18px] sm:h-36" />
    <div class="space-y-3 p-6">
      <div class="-mt-16 size-24 rounded-full bg-navy-800 ring-4 ring-navy-950 sm:size-28" />
      <div class="h-7 w-48 rounded-full bg-white/8" />
      <div class="h-4 w-28 rounded-full bg-white/5" />
      <span class="sr-only">Hämtar läktarplatsen…</span>
    </div>
  </div>

  <!-- Not found, or not public yet: the same answer, so nobody can probe for accounts -->
  <section v-else-if="status === 'hidden'" class="card px-6 py-12 text-center">
    <div class="stripes mx-auto h-12 w-9 rounded-md [--stripe:6px]" aria-hidden="true" />
    <h1 class="mt-5 font-display text-3xl font-bold">Tom plats på läktaren</h1>
    <p class="mx-auto mt-2 max-w-md text-krita-dim">
      Den här supportern har inte klivit fram i Snacket än – eller så finns platsen inte.
    </p>
    <p v-if="userId && userId === address && profileStatus === 'missing'" class="mt-5">
      <button class="rounded-full bg-guld px-6 py-3 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" @click="accountOpen = true">Välj ditt läktarnamn</button>
    </p>
    <NuxtLink v-else :to="links.section('snacket')" class="mt-6 inline-block rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold transition hover:border-himmel hover:text-himmel">Till Snacket på stan</NuxtLink>
  </section>

  <section v-else-if="status === 'error'" class="card px-6 py-12 text-center" role="alert">
    <h1 class="font-display text-2xl font-bold">Läktaren gick inte att nå</h1>
    <p class="mt-2 text-krita-dim">Vi fick ingen kontakt just nu.</p>
    <button class="mt-5 rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold transition hover:border-himmel hover:text-himmel" @click="wall.load()">Försök igen</button>
  </section>

  <template v-else-if="profile">
    <!-- The supporter -->
    <section class="card relative overflow-hidden" aria-labelledby="supporter-name">
      <!-- Phones: your settings (desktop has them beside the sidebar's profile card) -->
      <AccountSettingsButton v-if="own" class="absolute right-3 top-3 z-10 backdrop-blur lg:hidden" />
      <div class="relative h-28 sm:h-36" aria-hidden="true">
        <div class="stripes absolute inset-0 [--stripe:18px]" />
        <div class="absolute inset-0 bg-gradient-to-b from-transparent via-navy-950/20 to-navy-900" />
        <div class="absolute inset-x-0 bottom-0 flex h-2">
          <span class="flex-1 bg-navy-700" /><span class="flex-1 bg-guld" /><span class="flex-1 bg-rod" />
        </div>
      </div>
      <div class="px-5 pb-6 sm:px-7">
        <div class="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
          <Avatar :name="profile.displayName" :design="profile.avatar" size="xl" class="ring-4! ring-navy-900!" />
          <button v-if="own" class="mb-1 rounded-full border border-white/15 bg-navy-900/80 px-4 py-2 text-sm font-bold backdrop-blur transition hover:border-himmel hover:text-himmel" @click="editor.edit()">Ändra profil</button>
        </div>
        <p class="kicker mt-4 text-himmel">På läktaren</p>
        <h1 id="supporter-name" class="mt-1 break-words font-display text-4xl font-bold leading-none tracking-tight sm:text-5xl">{{ profile.displayName }}</h1>
        <p class="mt-1.5 text-krita-dim">@{{ profile.handle }}</p>
        <p v-if="profile.bio" class="mt-4 max-w-prose text-[1.05rem] leading-relaxed">{{ profile.bio }}</p>
        <p v-else-if="own" class="mt-4 text-sm text-krita-dim">
          Inget om dig än.
          <button class="font-semibold text-himmel underline-offset-2 hover:underline" @click="editor.edit()">Skriv några rader</button>
        </p>
        <p class="mt-5 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-sm font-semibold">
          <span aria-hidden="true">💬</span>{{ postsLabel }}
        </p>
        <p v-if="own && total === 0" class="mt-4 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm leading-relaxed text-krita-dim">
          Din läktarplats syns för andra när du har skrivit ett inlägg eller en kommentar i Snacket. Tills dess ser bara du den.
        </p>
      </div>
    </section>

    <!-- Only for the supporter themselves -->
    <section v-if="own" class="card mt-5 p-5 sm:p-6" aria-labelledby="my-teams">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-teams" class="font-display text-2xl font-bold">Mina lag</h2>
        <span class="text-xs font-semibold text-krita-dim">🔒 Bara för dig</span>
      </div>
      <p class="mt-1 text-sm leading-relaxed text-krita-dim">
        Vilka Djurgården följer du? Ingen annan ser ditt val, och vi gömmer aldrig något i flödet för att du gjort det.
      </p>
      <p v-if="preferences.status.value === 'unavailable'" class="mt-4 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-krita-dim">
        Mina lag går inte att använda här än – databasen har inte stöd för det ännu.
      </p>
      <p v-else-if="preferences.status.value === 'error'" class="mt-4 text-sm text-krita-dim" role="alert">
        Kunde inte hämta dina lag.
        <button class="font-semibold text-himmel hover:underline" @click="preferences.load()">Försök igen</button>
      </p>
      <div v-else class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" :aria-busy="preferences.status.value !== 'ready' || preferences.saving.value">
        <button
          v-for="t in TEAM_INTERESTS"
          :key="t.key"
          type="button"
          :aria-pressed="preferences.teams.value.includes(t.key)"
          :disabled="preferences.status.value !== 'ready' || preferences.saving.value"
          class="group flex flex-col items-start rounded-2xl border px-4 py-3 text-left transition disabled:cursor-wait motion-safe:enabled:hover:-translate-y-0.5"
          :class="preferences.teams.value.includes(t.key) ? 'border-himmel bg-himmel/12' : 'border-white/10 hover:border-white/25'"
          @click="preferences.toggle(t.key)"
        >
          <span class="text-lg" aria-hidden="true">{{ t.sport === 'Fotboll' ? '⚽' : '🏒' }}</span>
          <span class="mt-1 font-display text-lg font-bold leading-tight">{{ t.sport }}</span>
          <span class="text-sm text-krita-dim">{{ t.team }}</span>
          <span class="mt-2 text-xs font-bold" :class="preferences.teams.value.includes(t.key) ? 'text-himmel' : 'text-krita-dim'">
            {{ preferences.teams.value.includes(t.key) ? '✓ Följer' : 'Följ' }}
          </span>
        </button>
      </div>
      <p v-if="preferences.error.value" class="mt-3 text-sm font-semibold text-rod" role="alert">{{ preferences.error.value }}</p>
    </section>

    <!-- The wall -->
    <section class="mt-8" aria-labelledby="wall-title">
      <h2 id="wall-title" class="flex items-baseline gap-3 font-display text-2xl font-bold">
        Väggen
        <span class="text-sm font-semibold text-krita-dim">{{ postsLabel }}</span>
      </h2>
      <ul v-if="feedPosts.length" class="mt-4 space-y-4">
        <li v-for="post in feedPosts" :id="`post-${post.id}`" :key="post.id">
          <PostCard :post="post" on-wall @removed="wall.forget" />
        </li>
      </ul>
      <div v-else class="mt-4 rounded-3xl border border-dashed border-white/12 px-6 py-10 text-center">
        <p class="font-display text-xl font-bold">{{ own ? 'Din vägg väntar på första ramsan.' : 'Läktarplatsen är tom än så länge.' }}</p>
        <NuxtLink v-if="own" :to="links.section('snacket')" class="mt-4 inline-block rounded-full bg-guld px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5">Skriv i Snacket</NuxtLink>
      </div>
      <div v-if="more" class="mt-6 text-center">
        <button class="rounded-full border border-white/15 px-6 py-3 text-sm font-bold transition hover:border-himmel hover:text-himmel disabled:opacity-50" :disabled="loadingMore" @click="wall.loadMore()">
          {{ loadingMore ? 'Hämtar…' : 'Visa fler' }}
        </button>
        <p v-if="moreError" class="mt-2 text-sm text-krita-dim" role="alert">Kunde inte hämta fler. Försök igen.</p>
      </div>
    </section>
  </template>
</template>
