<script setup lang="ts">
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
 * On your own place: the account menu (the gear, on phones; desktop has it
 * in the sidebar's profile card) and "Du följer". Editing your profile and
 * your settings ("Mina lag", now at /installningar) are in the account menu,
 * not in the header.
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
const interactions = useInteractions()
// Stories in the feeds right now: posts from before frozen Stories still link to theirs.
useNews()

const own = computed(() => !!userId.value && userId.value === wall.id.value)

/*
 * Following (#9), private: only you see whom you follow. "Följ" on someone
 * else's place, a friendly way in when you can't follow yet, and on your own
 * place a list of the public supporters you follow. Shown only once the
 * database is known to support it.
 */
const follows = useFollows()
/** 'signin' / 'profile': why you can't follow yet; any other text: what went wrong. */
const followNote = ref<string | null>(null)
const followingThem = computed(() => !!wall.id.value && !!follows.following.value[wall.id.value])
const followBusy = computed(() => !!wall.id.value && (!!follows.pending.value[wall.id.value] || (!!userId.value && !(wall.id.value in follows.following.value))))
const showFollow = computed(() => !own.value && !!wall.id.value && follows.status.value === 'ready')
async function tapFollow() {
  followNote.value = null
  if (!userId.value) return void (followNote.value = 'signin')
  if (profileStatus.value === 'missing') return void (followNote.value = 'profile')
  const r = await follows.toggle(wall.id.value!)
  if (!r.ok) followNote.value = r.message
}
// Someone else's place: do you follow them? (Signed out: is following here at all?)
watch([() => wall.id.value, userId], ([id]) => {
  followNote.value = null
  if (id && !own.value) void follows.check(id)
}, { immediate: true })
// Your own place: the supporters you follow.
watch(own, (mine) => {
  if (mine) void follows.loadList()
}, { immediate: true })

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
      <!-- Phones: the account menu (desktop opens it from the sidebar's profile card) -->
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
          <!-- Follow (private): "Följ" until Supabase confirms, then "Följer"; tapping "Följer" stops following. Never on your own place. -->
          <button
            v-if="showFollow"
            v-ripple
            type="button"
            class="relative mb-1 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold backdrop-blur transition disabled:opacity-60"
            :class="followingThem ? 'border border-white/15 bg-navy-900/80 hover:border-rod/60 hover:text-krita' : 'bg-guld text-navy-950 hover:-translate-y-0.5'"
            :aria-pressed="followingThem"
            :aria-busy="followBusy"
            :disabled="followBusy"
            :title="followingThem ? 'Sluta följa' : undefined"
            @click="tapFollow"
          >
            <svg v-if="followingThem" viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            {{ followingThem ? 'Följer' : 'Följ' }}<span class="sr-only"> {{ profile.displayName }}</span>
          </button>
        </div>
        <!-- Who, and beside it (beneath on a narrow screen) the supporter's numbers: only real ones -->
        <div class="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div class="min-w-0 max-w-full">
            <p class="kicker text-himmel">På läktaren</p>
            <h1 id="supporter-name" class="mt-1 break-words font-display text-4xl font-bold leading-none tracking-tight sm:text-5xl">{{ profile.displayName }}</h1>
            <p class="mt-1.5 text-krita-dim">@{{ profile.handle }}</p>
          </div>
          <!--
            Snack: their posts in Snacket, as counted by Supabase (the same count as the wall's).
            No follower or following numbers: follows are private (Following v1), so there is
            nothing that may be counted for others to see yet. Never a made-up number.
          -->
          <dl v-if="total !== null" class="flex gap-2" aria-label="Siffror">
            <div class="flex min-w-20 flex-col-reverse items-center rounded-2xl bg-white/[0.06] px-4 py-2">
              <dt class="text-xs font-semibold text-krita-dim">Snack</dt>
              <dd class="font-display text-2xl font-bold leading-tight tabular-nums">{{ total }}</dd>
            </div>
          </dl>
        </div>
        <!-- Can't follow yet: a way in, never a dead button. Or what went wrong. -->
        <div v-if="followNote && !own" class="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm" :role="followNote === 'signin' || followNote === 'profile' ? 'status' : 'alert'">
          <template v-if="followNote === 'signin'">
            <p class="min-w-0 flex-1"><span class="font-semibold">Vill du följa {{ profile.displayName }}?</span> <span class="text-krita-dim">Logga in, så hittar du tillbaka hit från din egen läktarplats.</span></p>
            <button class="rounded-full bg-guld px-4 py-1.5 text-xs font-bold text-navy-950" @click="accountOpen = true">Logga in</button>
          </template>
          <template v-else-if="followNote === 'profile'">
            <p class="min-w-0 flex-1">Välj ditt läktarnamn, så kan du följa supportrar.</p>
            <button class="rounded-full bg-guld px-4 py-1.5 text-xs font-bold text-navy-950" @click="accountOpen = true">Välj läktarnamn</button>
          </template>
          <p v-else class="min-w-0 flex-1 font-semibold text-rod">{{ followNote }}</p>
          <button class="text-xs text-krita-dim hover:text-krita" aria-label="Stäng" @click="followNote = null">✕</button>
        </div>
        <p v-if="profile.bio" class="mt-4 max-w-prose text-[1.05rem] leading-relaxed">{{ profile.bio }}</p>
        <p v-else-if="own" class="mt-4 text-sm text-krita-dim">
          Inget om dig än.
          <button class="font-semibold text-himmel underline-offset-2 hover:underline" @click="editor.edit()">Skriv några rader</button>
        </p>
        <p v-if="own && total === 0" class="mt-4 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm leading-relaxed text-krita-dim">
          Din läktarplats syns för andra när du har skrivit ett inlägg eller en kommentar i Snacket. Tills dess ser bara du den.
        </p>
      </div>
    </section>

    <!-- Whom you follow: only for you, only public supporters, newest follow first. Nothing here is shown to anyone else. -->
    <section v-if="own && follows.listStatus.value !== 'unavailable' && follows.listStatus.value !== 'idle'" class="card mt-5 p-5 sm:p-6" aria-labelledby="i-follow">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="i-follow" class="font-display text-2xl font-bold">Du följer</h2>
        <p class="text-xs text-krita-dim">Bara du ser vilka du följer.</p>
      </div>
      <ul v-if="follows.listStatus.value === 'loading' && !follows.list.value.length" class="mt-4 space-y-2" aria-busy="true" aria-label="Hämtar vilka du följer">
        <li v-for="n in 2" :key="n" class="h-14 animate-pulse rounded-2xl bg-white/[0.03]" />
      </ul>
      <p v-else-if="follows.listStatus.value === 'error'" class="mt-4 text-sm text-krita-dim" role="alert">
        Kunde inte hämta vilka du följer.
        <button class="font-semibold text-himmel hover:underline" @click="follows.loadList()">Försök igen</button>
      </p>
      <ul v-else-if="follows.list.value.length" class="mt-3 divide-y divide-white/6">
        <li v-for="p in follows.list.value" :key="p.id">
          <NuxtLink :to="links.supporter(p.handle)" class="group flex items-center gap-3 py-2.5">
            <Avatar :name="p.name" :design="p.avatar" size="md" />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold group-hover:text-himmel">{{ p.name }}</span>
              <span class="block truncate text-sm text-krita-dim">@{{ p.handle }}</span>
            </span>
            <span class="text-krita-dim transition group-hover:translate-x-1 group-hover:text-himmel" aria-hidden="true">→</span>
          </NuxtLink>
        </li>
      </ul>
      <p v-else class="mt-3 text-sm leading-relaxed text-krita-dim">
        Du följer ingen än. Tryck på ett namn i
        <NuxtLink :to="links.section('snacket')" class="font-semibold text-himmel hover:underline">Snacket</NuxtLink>
        och välj <span class="font-semibold text-krita">Följ</span>, så hittar du tillbaka till dem här.
      </p>
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
