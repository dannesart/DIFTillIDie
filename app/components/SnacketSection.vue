<script setup lang="ts">
import type { FeedMode } from '~/composables/useSnacket'

/*
 * Snacket på stan, in two clearly separate parts:
 *  1. The real feed: posts published by signed-in supporters, stored in
 *     Supabase and visible to everyone. Newest first, nothing ranked.
 *  2. Demo-snack: the fictional supporters (plus any old posts this browser
 *     kept locally), with its Hetast/Nyast sorting. Never mixed with 1.
 */
const { feed, all, realAll, realFeed, community, mode, filter, me, identity, guestPostCount, setName } = useSnacket()
const { status: realStatus, stale, refreshing } = community
const { stories } = useNews()
const { status } = useAuth()
const accountOpen = useAccountDialog()
const canSignIn = computed(() => status.value !== 'unavailable')

const modes: { value: FeedMode, label: string, hint: string }[] = [
  { value: 'hetast', label: 'Hetast', hint: 'Mest kärlek, svalnar med tiden' },
  { value: 'nyast', label: 'Nyast', hint: 'Senaste först' },
]

const filterStory = computed(() => stories.value.find(s => storyAnswersTo(s, filter.value.storyId)))
const hasFilter = computed(() => !!(filter.value.tag || filter.value.storyId))
const realLoading = computed(() => realStatus.value === 'idle' || realStatus.value === 'loading')

const tags = computed(() => {
  const counts = new Map<string, number>()
  for (const p of [...realAll.value, ...all.value]) {
    for (const t of tokenize(p.body)) {
      if (t.type === 'tag') counts.set(t.value.toLowerCase(), (counts.get(t.value.toLowerCase()) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
})

const editingName = ref(false)
const nameDraft = ref('')
function startEditName() {
  nameDraft.value = me.value && me.value.name !== 'Du' ? me.value.name : ''
  editingName.value = true
}
function saveName() {
  setName(nameDraft.value)
  editingName.value = false
}

const composer = useTemplateRef<{ mention: (h: string) => void }>('composer')
</script>

<template>
  <section id="snacket" class="relative scroll-mt-16 border-y border-white/8 bg-natt/60 py-16 lg:py-24">
    <div aria-hidden="true" class="stripes absolute inset-x-0 top-0 h-1 opacity-60 [--stripe:24px]" />
    <div class="mx-auto max-w-7xl px-4 sm:px-6">
      <div>
        <p class="kicker text-guld">Community</p>
        <h2 class="section-title mt-3">Snacket <span class="italic font-normal text-himmel">på stan</span></h2>
      </div>

      <div class="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0">
          <PostComposer ref="composer" />

          <div v-if="hasFilter" class="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <span class="text-krita-dim">Visar</span>
            <button class="chip border-guld/50 bg-guld/10 text-guld hover:bg-guld/20" @click="filter = {}">
              <template v-if="filter.tag">#{{ filter.tag }}</template>
              <template v-else-if="filterStory">Story: {{ leadOf(filterStory).headline }}</template>
              <span aria-hidden="true" class="ml-1">✕</span>
              <span class="sr-only">Rensa filter</span>
            </button>
          </div>

          <!-- 1. The real feed -->
          <section v-if="realStatus !== 'unavailable'" id="snacket-real" class="mt-8 scroll-mt-24" aria-labelledby="snacket-real-title" :aria-busy="realLoading || refreshing">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h3 id="snacket-real-title" class="flex items-center gap-2 font-display text-xl font-bold">
                Från läktaren
                <span class="kicker rounded-full bg-himmel/15 px-2 py-0.5 text-himmel">På riktigt</span>
              </h3>
              <button
                v-if="realStatus === 'ready' || stale"
                class="text-xs font-semibold text-krita-dim hover:text-krita disabled:opacity-50"
                :disabled="refreshing"
                @click="community.refresh()"
              >
                {{ refreshing ? 'Hämtar…' : 'Hämta nya inlägg' }}
              </button>
            </div>
            <p class="mt-1 text-xs text-krita-dim">Publicerat av inloggade Djurgårdare. Nyast först.</p>

            <p v-if="stale" class="mt-3 text-xs font-semibold text-guld" role="status">Kunde inte hämta nya inlägg just nu – visar de senast hämtade.</p>

            <!-- Loading: placeholders, never invented content -->
            <ul v-if="realLoading" class="mt-4 space-y-4" aria-label="Hämtar inlägg">
              <li v-for="n in 2" :key="n" class="card h-28 animate-pulse bg-white/[0.03]" />
            </ul>

            <div v-else-if="realStatus === 'error'" class="card mt-4 p-5 text-sm" role="alert">
              <p>Kunde inte hämta inläggen från läktaren.</p>
              <button class="mt-2 font-semibold text-himmel hover:underline" @click="community.refresh()">Försök igen</button>
            </div>

            <template v-else>
              <TransitionGroup
                tag="ul"
                class="relative mt-4 space-y-4"
                enter-from-class="opacity-0 -translate-y-3"
                enter-active-class="transition duration-500"
                leave-to-class="opacity-0"
                leave-active-class="transition duration-200 absolute inset-x-0"
              >
                <li v-for="post in realFeed" :key="post.id">
                  <PostCard :post="post" @mention="composer?.mention($event)" />
                </li>
              </TransitionGroup>
              <p v-if="!realFeed.length" class="card mt-4 p-5 text-sm text-krita-dim">
                <template v-if="realAll.length">Inga riktiga inlägg om det här än.</template>
                <template v-else>Inga riktiga inlägg än. Bli den första Djurgårdaren som skriver här! 💙</template>
              </p>
            </template>
          </section>

          <!-- 2. Demo-snack: fictional, and separate -->
          <section class="mt-14 border-t border-dashed border-white/15 pt-8" aria-labelledby="snacket-demo-title">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <h3 id="snacket-demo-title" class="flex items-center gap-2 font-display text-xl font-bold text-krita-dim">
                Demo-snack
                <span class="kicker rounded-full border border-guld/40 px-2 py-0.5 text-guld">Påhittat</span>
              </h3>
              <div class="relative grid grid-cols-2 rounded-full border border-white/10 bg-navy-900 p-1" role="tablist" aria-label="Sortera demo-snacket">
                <span
                  aria-hidden="true"
                  class="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-krita transition-transform duration-500 ease-spring"
                  :class="mode === 'nyast' && 'translate-x-full'"
                />
                <button
                  v-for="m in modes"
                  :key="m.value"
                  role="tab"
                  :aria-selected="mode === m.value"
                  :title="m.hint"
                  class="relative z-10 rounded-full px-4 py-1.5 text-sm font-bold transition-colors duration-300"
                  :class="mode === m.value ? 'text-navy-950' : 'text-krita-dim hover:text-krita'"
                  @click="mode = m.value"
                >
                  {{ m.label }}
                </button>
              </div>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-krita-dim">
              Påhittade supportrar och inlägg som visar idén. Reaktioner och kommentarer här, och inlägg du skrev innan Snacket blev riktigt, finns bara i din webbläsare.
            </p>

            <TransitionGroup
              tag="ul"
              class="relative mt-4 space-y-4"
              move-class="transition duration-500 ease-out-expo"
              enter-from-class="opacity-0 -translate-y-3"
              enter-active-class="transition duration-500"
              leave-to-class="opacity-0"
              leave-active-class="transition duration-200 absolute inset-x-0"
            >
              <li v-for="post in feed" :key="post.id">
                <PostCard :post="post" @mention="composer?.mention($event)" />
              </li>
            </TransitionGroup>
            <p v-if="!feed.length" class="mt-6 text-center text-sm text-krita-dim">Inget demo-snack om det här.</p>
          </section>
        </div>

        <aside class="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div class="card p-5">
            <p class="kicker text-krita-dim">Du på läktaren</p>
            <!-- Signed in with a profile: that's who you are here -->
            <template v-if="identity.kind === 'member' && me">
              <div class="mt-3 flex items-center gap-3">
                <Avatar :name="me.name" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold">{{ me.name }}</p>
                  <p class="truncate text-xs text-krita-dim">@{{ me.handle }}</p>
                </div>
                <button class="text-xs font-semibold text-himmel hover:underline" @click="accountOpen = true">Din profil</button>
              </div>
              <p class="mt-3 text-xs leading-relaxed text-krita-dim">
                Det du publicerar syns för alla, med det här namnet och handlet.
              </p>
              <p v-if="guestPostCount" class="mt-2 text-xs leading-relaxed text-krita-dim">
                {{ guestPostCount === 1 ? 'Ditt gamla inlägg' : `Dina ${guestPostCount} gamla inlägg` }} som gäst ligger kvar, bara i den här webbläsaren, och syns igen när du loggar ut.
              </p>
            </template>

            <!-- Signed in, but no name chosen yet -->
            <template v-else-if="identity.kind === 'needs-profile'">
              <p class="mt-3 text-sm leading-relaxed">Välj ditt läktarnamn, så kan du publicera.</p>
              <button class="mt-3 rounded-full bg-guld px-4 py-2 text-sm font-bold text-navy-950 transition hover:-translate-y-0.5" @click="accountOpen = true">Välj läktarnamn</button>
            </template>

            <!-- Guest: a local name for the demo -->
            <template v-else-if="identity.kind === 'guest' && me">
              <form v-if="editingName" class="mt-3 flex gap-2" @submit.prevent="saveName">
                <input v-model="nameDraft" maxlength="32" autofocus placeholder="Ditt gästnamn" class="min-w-0 flex-1 rounded-full border border-white/12 bg-navy-950 px-4 py-2 text-sm outline-none focus:border-himmel">
                <button class="rounded-full bg-himmel px-4 text-sm font-bold text-navy-950">Spara</button>
              </form>
              <div v-else class="mt-3 flex items-center gap-3">
                <Avatar :name="me.name" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold">{{ me.name }}</p>
                  <p class="truncate text-xs text-krita-dim">@{{ me.handle }} · gäst</p>
                </div>
                <button class="text-xs font-semibold text-himmel hover:underline" @click="startEditName">Byt namn</button>
              </div>
              <p class="mt-3 text-xs leading-relaxed text-krita-dim">
                Som gäst kan du läsa allt, och reagera och kommentera i demo-snacket (bara i den här webbläsaren).
                <button v-if="canSignIn" class="font-semibold text-himmel hover:underline" @click="accountOpen = true">Logga in</button><template v-if="canSignIn"> för att publicera på riktigt.</template>
              </p>
            </template>

            <p v-else class="mt-3 text-sm text-krita-dim" aria-live="polite">Ett ögonblick…</p>
          </div>

          <div class="card p-5">
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
