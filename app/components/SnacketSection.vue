<script setup lang="ts">
import type { FeedSort } from '~/lib/feedSort'
import { createFeedSort, engagement } from '~/lib/feedSort'
import { postAnchor } from '~/lib/reveal'

/*
 * Snacket på stan: posts, reactions and comments by signed-in supporters,
 * stored in Supabase and readable by everyone. Nyast by default; Hetast
 * ranks the loaded posts by their real reactions and comments (lib/feedSort).
 * Hashtags and filters come only from these posts. Writing happens in the
 * compose dialog (ComposeDialog), opened from the entry at the top or an @mention.
 */
const { feed, all, community, filter, sort, sport, me, identity } = useSnacket()
const { stats, statsStatus, statsLoadedAt } = useInteractions()
const { status: feedStatus, stale, refreshing } = community
const { stories } = useNews()
const { status } = useAuth()
const accountOpen = useAccountDialog()
const canSignIn = computed(() => status.value !== 'unavailable')

const filterStory = computed(() => findStory(stories.value, filter.value.storyId))
const hasFilter = computed(() => !!(filter.value.tag || filter.value.storyId))
const loading = computed(() => feedStatus.value === 'idle' || feedStatus.value === 'loading')

const sorts: { value: FeedSort, label: string, hint: string }[] = [
  { value: 'hetast', label: 'Hetast', hint: 'Mest reaktioner och kommentarer, svalnar med tiden' },
  { value: 'nyast', label: 'Nyast', hint: 'Senaste först' },
]
// Filters first (feed), then the order.
const feedSort = createFeedSort({ sort, posts: all, stats, statsStatus, statsLoadedAt })
const sortState = feedSort.state
const shown = computed(() => feedSort.apply(feed.value))
const anyEngagement = computed(() => all.value.some(p => engagement(stats.value[p.id]) > 0))

const tags = computed(() => {
  const counts = new Map<string, number>()
  for (const p of all.value) {
    for (const t of tokenize(p.body)) {
      if (t.type === 'tag') counts.set(t.value.toLowerCase(), (counts.get(t.value.toLowerCase()) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
})

const compose = useCompose()
// A post started here begins from what you're browsing: the sport, the Story whose posts these are.
const browsing = () => ({ sport: sport.value === 'alla' ? undefined : sport.value, storyId: filterStory.value ? filter.value.storyId : undefined })
/** The draft in progress, shown in the entry so it's clear nothing was lost. */
const draftText = computed(() => (identity.value.kind === 'guest' ? '' : compose.post.value.body.trim()))

function mention(handle: string) {
  // Guests are invited to sign in, as before; there's nothing to write with yet.
  if (identity.value.kind === 'guest') accountOpen.value = true
  else compose.mention(handle, browsing())
}
</script>

<template>
  <section id="snacket" class="relative scroll-mt-16 border-y border-white/8 bg-natt/60 py-16 lg:py-24">
    <div aria-hidden="true" class="stripes absolute inset-x-0 top-0 h-1 opacity-60 [--stripe:24px]" />
    <div class="mx-auto max-w-7xl px-4 sm:px-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="kicker text-guld">Community</p>
          <h2 class="section-title mt-3">Snacket <span class="italic font-normal text-himmel">på stan</span></h2>
        </div>
        <button
          v-if="feedStatus === 'ready' || stale"
          class="text-sm font-semibold text-krita-dim hover:text-krita disabled:opacity-50"
          :disabled="refreshing"
          @click="community.refresh()"
        >
          {{ refreshing ? 'Hämtar…' : 'Hämta nya inlägg' }}
        </button>
      </div>

      <div class="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0">
          <!-- Compact: the composer itself opens in a dialog, with the draft as it was left -->
          <button
            type="button"
            class="card flex w-full items-center gap-3 p-4 text-left transition hover:border-himmel/40 sm:p-5"
            aria-haspopup="dialog"
            @click="compose.openPost(browsing())"
          >
            <Avatar :name="me?.name ?? 'Du'" :design="me?.avatar" />
            <span class="min-w-0 flex-1">
              <span v-if="draftText" class="block text-xs font-semibold text-guld">Ditt utkast</span>
              <span v-if="draftText" class="block truncate text-krita">{{ draftText }}</span>
              <span v-else class="block text-base text-krita-dim">Vad snackas det om på stan?</span>
            </span>
            <span aria-hidden="true" class="shrink-0 rounded-full bg-himmel px-4 py-2 text-sm font-bold text-navy-950">{{ draftText ? 'Fortsätt' : 'Skriv' }}</span>
          </button>

          <div v-if="hasFilter || all.length" class="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div v-if="hasFilter" class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span class="text-krita-dim">Visar</span>
              <button class="chip border-guld/50 bg-guld/10 text-guld hover:bg-guld/20" @click="filter = {}">
                <template v-if="filter.tag">#{{ filter.tag }}</template>
                <template v-else-if="filterStory">Story: {{ leadOf(filterStory).headline }}</template>
                <span aria-hidden="true" class="ml-1">✕</span>
                <span class="sr-only">Rensa filter</span>
              </button>
            </div>
            <div v-if="all.length" class="relative ml-auto grid grid-cols-2 rounded-full border border-white/10 bg-navy-900 p-1" role="tablist" aria-label="Sortera snacket">
              <span
                aria-hidden="true"
                class="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-krita transition-transform duration-500 ease-spring"
                :class="sort === 'nyast' && 'translate-x-full'"
              />
              <button
                v-for="m in sorts"
                :key="m.value"
                role="tab"
                :aria-selected="sort === m.value"
                aria-controls="snacket-feed"
                :title="m.hint"
                class="relative z-10 rounded-full px-4 py-1.5 text-sm font-bold transition-colors duration-300"
                :class="sort === m.value ? 'text-navy-950' : 'text-krita-dim hover:text-krita'"
                @click="sort = m.value"
              >
                {{ m.label }}
              </button>
            </div>
          </div>
          <!-- Hetast is only ever about what's loaded here, and says so -->
          <p v-if="sortState !== 'newest' && all.length" class="mt-2 text-right text-xs leading-relaxed text-krita-dim" role="status">
            <template v-if="sortState === 'waiting'">Hämtar reaktioner och kommentarer… nyast först så länge.</template>
            <template v-else-if="sortState === 'unavailable'">Kunde inte hämta reaktioner och kommentarer – visar nyast först.</template>
            <template v-else-if="!anyEngagement">Inga reaktioner eller kommentarer än – nyast först.</template>
            <template v-else>Bland de {{ all.length }} senaste inläggen: reaktioner och kommentarer, nyare väger tyngre.</template>
          </p>

          <section id="snacket-feed" class="scroll-below-header mt-6" :aria-label="sortState === 'ranked' ? 'Inlägg, hetast först' : 'Inlägg, nyast först'" :aria-busy="loading || refreshing">
            <p v-if="feedStatus === 'unavailable'" class="card p-5 text-sm text-krita-dim">Snacket är inte påslaget här.</p>

            <template v-else>
              <p v-if="stale" class="mb-3 text-xs font-semibold text-guld" role="status">Kunde inte hämta nya inlägg just nu – visar de senast hämtade.</p>

              <!-- Loading: placeholders, never invented content -->
              <ul v-if="loading" class="space-y-4" aria-label="Hämtar inlägg">
                <li v-for="n in 3" :key="n" class="card h-32 animate-pulse bg-white/[0.03]" />
              </ul>

              <div v-else-if="feedStatus === 'error'" class="card p-5 text-sm" role="alert">
                <p>Kunde inte hämta snacket just nu.</p>
                <button class="mt-2 font-semibold text-himmel hover:underline" @click="community.refresh()">Försök igen</button>
              </div>

              <template v-else>
                <TransitionGroup
                  tag="ul"
                  class="relative space-y-4"
                  move-class="transition duration-500 ease-out-expo"
                  enter-from-class="opacity-0 -translate-y-3"
                  enter-active-class="transition duration-500"
                  leave-to-class="opacity-0"
                  leave-active-class="transition duration-200 absolute inset-x-0"
                >
                  <li v-for="post in shown" :id="postAnchor(post.id)" :key="post.id" class="scroll-below-header">
                    <PostCard :post="post" @mention="mention" />
                  </li>
                </TransitionGroup>
                <div v-if="!shown.length" class="card p-6 text-center">
                  <template v-if="all.length">
                    <p class="font-semibold">Tyst på stan just här.</p>
                    <p class="mt-1 text-sm text-krita-dim">Inga inlägg om det här än.</p>
                  </template>
                  <template v-else>
                    <p class="font-display text-xl font-bold">Läktaren väntar på första ramsan 💙</p>
                    <p class="mt-1 text-sm text-krita-dim">Inga inlägg än. Bli den första Djurgårdaren som skriver här!</p>
                  </template>
                </div>
              </template>
            </template>
          </section>
        </div>

        <aside class="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div class="card p-5">
            <p class="kicker text-krita-dim">Du på läktaren</p>
            <!-- Signed in with a profile: that's who you are here -->
            <template v-if="identity.kind === 'member' && me">
              <div class="mt-3 flex items-center gap-3">
                <Avatar :name="me.name" :design="me.avatar" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold">{{ me.name }}</p>
                  <p class="truncate text-xs text-krita-dim">@{{ me.handle }}</p>
                </div>
                <button class="text-xs font-semibold text-himmel hover:underline" @click="accountOpen = true">Din profil</button>
              </div>
              <p class="mt-3 text-xs leading-relaxed text-krita-dim">
                Det du publicerar och kommenterar syns för alla, med det här namnet och handlet.
              </p>
            </template>

            <!-- Signed in, but no name chosen yet -->
            <template v-else-if="identity.kind === 'needs-profile'">
              <p class="mt-3 text-sm leading-relaxed">Välj ditt läktarnamn, så kan du publicera, reagera och kommentera.</p>
              <button class="mt-3 rounded-full bg-guld px-4 py-2 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" @click="accountOpen = true">Välj läktarnamn</button>
            </template>

            <!-- Signed out: read everything, sign in to join -->
            <template v-else-if="identity.kind === 'guest'">
              <p class="mt-3 text-sm leading-relaxed">Alla kan läsa snacket.</p>
              <p class="mt-1 text-xs leading-relaxed text-krita-dim">
                <template v-if="canSignIn">
                  <button class="font-semibold text-himmel hover:underline" @click="accountOpen = true">Logga in</button> för att publicera, reagera och kommentera med din supporterprofil.
                </template>
                <template v-else>Att skriva är inte påslaget här.</template>
              </p>
            </template>

            <p v-else class="mt-3 text-sm text-krita-dim" aria-live="polite">Ett ögonblick…</p>
          </div>

          <div v-if="tags.length" class="card p-5">
            <p class="kicker text-krita-dim">Det snackas om</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="[tag, count] in tags"
                :key="tag"
                class="chip"
                :class="filter.tag === tag ? 'border-guld bg-guld text-navy-950' : 'border-white/12 hover:border-guld/60 hover:text-guld'"
                @click="filter = filter.tag === tag ? {} : { tag }"
              >
                #{{ tag }} <span class="opacity-50">{{ count }}</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </section>
</template>
