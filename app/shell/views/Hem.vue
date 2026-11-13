<script setup lang="ts">
import type { Story } from '#shared/types/domain'
import type { FeedPost } from '~/composables/useSnacket'
import { frozenLead } from '~/lib/posts'

/*
 * The shell's home, on every screen size: an overview, not a feed. A small
 * hero, then what's being said on the läktare and what's happening in the
 * Stories, side by side as short previews of the real thing, each leading
 * into its own page. On desktop the next match and the podcasts are in the
 * rail, so they aren't repeated here; where there's no rail they follow.
 */
const links = useSectionLinks()
const { all, community, countForStory, filter } = useSnacket()
const { status: feedStatus } = community
const { stories, status: newsStatus } = useNews()
const { matches } = useSport()
const { show } = useStorySpotlight()

const demoNow = useDemoNow()
const now = useNow(60_000)
const greeting = computed(() => ({
  morgon: 'God morgon, Djurgårdare',
  dag: 'Hej, Djurgårdare',
  kvall: 'God kväll, Djurgårdare',
  natt: 'Sent ute, Djurgårdare?',
})[dayPart(now.value ?? demoNow.value)])

const PREVIEWS = 5
const latest = computed(() => all.value.filter(p => matches(p.sport)).slice(0, PREVIEWS))
const loading = computed(() => feedStatus.value === 'idle' || feedStatus.value === 'loading')
const topStories = computed(() => stories.value.filter(s => matches(s.sport)).slice(0, PREVIEWS))

// The Story a post is about, by its own headline: as kept with the post, or as it is in the feeds (storyOfPost, as everywhere).
function aboutStory(post: FeedPost) {
  if (post.storyRef) return frozenLead(post.storyRef)?.headline
  const live = storyOfPost(stories.value, post)
  return live && leadOf(live).headline
}

const storyPath = (s: Story) => `${links.value.view('stories')}#${s.id}`
async function openStory(s: Story) {
  await navigateTo(storyPath(s))
  show(s.id)
}
function readTalk(s: Story) {
  filter.value = { storyId: s.id }
  void navigateTo(links.value.view('snacket'))
}
const sportLabel = { fotboll: 'Fotboll', hockey: 'Hockey' } as const
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 pb-24 sm:px-6 lg:max-w-7xl lg:pt-8">
    <div class="@container">
      <!-- A smaller hero: who we are, in one band -->
      <section class="relative isolate mt-4 overflow-hidden rounded-[2rem] border border-white/8 bg-navy-900/60 px-6 py-7 sm:px-8 lg:mt-0">
        <div aria-hidden="true" class="grain absolute -right-10 -top-8 -z-10 h-56 w-56 rotate-[8deg] overflow-hidden rounded-[2rem] opacity-70">
          <div class="stripes absolute inset-0 [--stripe:22px]" />
          <div class="absolute inset-0 bg-gradient-to-l from-transparent via-navy-900/40 to-navy-900" />
        </div>
        <p class="kicker flex items-center gap-2 text-himmel">
          <span class="inline-block size-1.5 rounded-full bg-guld" />
          {{ greeting }}
        </p>
        <h1 class="mt-3 font-display font-black leading-[0.9] tracking-[-0.03em]">
          <!-- One unbreakable word, about 5em wide: never wider than the band inside its padding, so a phone or larger text can't cut it (Issue #16) -->
          <span class="stripe-text leading-none text-[min(3rem,calc((100cqi_-_3rem)/5.2))] sm:text-[min(3.75rem,calc((100cqi_-_4rem)/5.2))]">Djurgår’n</span>
          <span class="mt-1 block text-3xl font-semibold italic text-krita sm:ml-2 sm:mt-0 sm:inline sm:text-4xl">tills jag dör<span class="text-rod">.</span></span>
        </h1>
        <p class="mt-3 max-w-md text-sm leading-relaxed text-krita-dim">
          Fotboll och hockey, snack från läktaren och poddar för långa kvällar.
        </p>
      </section>

      <!-- The overview: two short lists side by side where there's room, stacked (and shorter) where there isn't -->
      <div class="mt-8 grid grid-cols-1 gap-6 @lg:grid-cols-2">
        <section class="card flex flex-col p-5" aria-labelledby="hem-snacket">
          <p class="kicker text-guld">Snacket på stan</p>
          <h2 id="hem-snacket" class="mt-1 font-display text-2xl font-bold">På läktaren nu</h2>

          <ul v-if="loading" class="mt-4 space-y-3" aria-label="Hämtar inlägg">
            <li v-for="n in 3" :key="n" class="h-16 animate-pulse rounded-2xl bg-white/[0.03]" />
          </ul>
          <p v-else-if="feedStatus === 'unavailable'" class="mt-4 text-sm text-krita-dim">Snacket är inte påslaget här.</p>
          <p v-else-if="feedStatus === 'error'" class="mt-4 text-sm" role="alert">Kunde inte hämta snacket just nu.</p>
          <ul v-else-if="latest.length" class="mt-3 divide-y divide-white/6">
            <li v-for="post in latest" :key="post.id" class="flex gap-3 py-3 [&:nth-child(n+4)]:hidden @lg:[&:nth-child(n+4)]:flex">
              <NuxtLink :to="links.supporter(post.author.handle)" class="shrink-0 rounded-full transition hover:scale-105" tabindex="-1" :aria-label="`${post.author.name} på läktaren`">
                <Avatar :name="post.author.name" :design="post.author.avatar" size="sm" />
              </NuxtLink>
              <div class="min-w-0 flex-1">
                <p class="flex items-baseline gap-2 text-sm">
                  <NuxtLink :to="links.supporter(post.author.handle)" class="truncate font-semibold hover:text-himmel">{{ post.author.name }}</NuxtLink>
                  <span class="shrink-0 text-xs text-krita-dim"><TimeAgo :at="post.createdAt" /></span>
                </p>
                <NuxtLink :to="links.view('snacket')" class="mt-0.5 line-clamp-2 text-sm leading-snug text-krita/90 hover:text-krita">{{ post.body }}</NuxtLink>
                <p v-if="aboutStory(post)" class="mt-1 flex items-center gap-1.5 text-xs text-krita-dim">
                  <span aria-hidden="true" class="h-3 w-1 shrink-0 rounded-full" style="background: repeating-linear-gradient(180deg, var(--color-himmel) 0 3px, var(--color-navy-700) 3px 6px)" />
                  <span class="truncate">Om: {{ aboutStory(post) }}</span>
                </p>
              </div>
            </li>
          </ul>
          <p v-else class="mt-4 font-display text-lg font-bold">Läktaren väntar på första ramsan 💙</p>

          <NuxtLink :to="links.view('snacket')" class="mt-auto self-start pt-4 text-sm font-bold text-himmel hover:underline">Till Snacket →</NuxtLink>
        </section>

        <section class="card flex flex-col p-5" aria-labelledby="hem-stories">
          <p class="kicker text-himmel">Stories · riktiga nyheter</p>
          <h2 id="hem-stories" class="mt-1 font-display text-2xl font-bold">Det som händer</h2>

          <ul v-if="newsStatus === 'pending' && !stories.length" class="mt-4 space-y-3" aria-busy="true">
            <li v-for="n in 3" :key="n" class="h-16 animate-pulse rounded-2xl bg-white/[0.03]" />
          </ul>
          <p v-else-if="!topStories.length" class="mt-4 text-sm text-krita-dim">Inga nyheter om Djurgården i källorna just nu.</p>
          <ul v-else class="mt-3 divide-y divide-white/6">
            <li v-for="s in topStories" :key="s.id" class="py-3 [&:nth-child(n+4)]:hidden @lg:[&:nth-child(n+4)]:block">
              <p class="kicker flex items-center gap-2 text-krita-dim">
                <span class="size-1.5 shrink-0 rounded-full bg-himmel" />
                <span class="truncate">{{ sportLabel[s.sport] }} · {{ leadOf(s).outlet }}</span>
                <span class="ml-auto shrink-0"><TimeAgo :at="leadOf(s).publishedAt" /></span>
              </p>
              <NuxtLink :to="storyPath(s)" class="mt-1 line-clamp-2 font-display text-base font-semibold leading-snug hover:text-himmel" @click.prevent="openStory(s)">{{ leadOf(s).headline }}</NuxtLink>
              <p class="mt-1 flex gap-3 text-xs text-krita-dim">
                <span>{{ s.sources.length }} {{ s.sources.length === 1 ? 'källa' : 'källor' }}</span>
                <button v-if="countForStory(s)" class="font-semibold text-guld hover:underline" @click="readTalk(s)">{{ countForStory(s) }} i Snacket</button>
              </p>
            </li>
          </ul>

          <NuxtLink :to="links.view('stories')" class="mt-auto self-start pt-4 text-sm font-bold text-himmel hover:underline">Alla stories →</NuxtLink>
        </section>
      </div>

      <!-- On a laptop the rail isn't shown: the next match comes here instead, after the overview -->
      <MatchCard class="mt-8 xl:hidden" />

      <!-- On phones and tablets, the rail's newest episodes too: Hem is their front page (Issue #16) -->
      <LatestEpisodes heading-id="hem-listen" class="mt-8 lg:hidden" />
    </div>
  </div>
</template>
