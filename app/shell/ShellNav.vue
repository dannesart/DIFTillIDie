<script setup lang="ts">
import type { SportFilter } from '~/composables/useDemo'
import type { SectionId } from '~/lib/sectionLinks'
import NavIcon from './NavIcon.vue'

/*
 * The shell's persistent sidebar: the place you're in, always one click
 * from the others. Everything here already exists on the site (the header's
 * sport switch, the bottom nav's sections, the account); it only moves.
 * The mini-player docks at its foot (see MiniPlayer.vue).
 */
const route = useRoute()
const links = useSectionLinks()
const { sport } = useSport()
const { status, profile, profileStatus } = useAuth()
const accountOpen = useAccountDialog()
const { current, playing } = usePodcastPlayer()
const demoNow = useDemoNow()
const days = computed(() => daysSinceFounding(demoNow.value).toLocaleString('sv-SE'))

const sections: { id: SectionId, label: string }[] = [
  { id: 'hem', label: 'Hem' },
  { id: 'snacket', label: 'Snacket' },
  { id: 'stories', label: 'Stories' },
  { id: 'lyssna', label: 'Lyssna' },
]
const sports: { value: SportFilter, label: string }[] = [
  { value: 'alla', label: 'Allt' },
  { value: 'fotboll', label: 'Fotboll' },
  { value: 'hockey', label: 'Hockey' },
]

const mine = computed(() => (profile.value ? links.value.supporter(profile.value.handle) : null))
const onMine = computed(() => !!mine.value && route.path === mine.value)
const accountLabel = computed(() => {
  if (status.value !== 'signed-in') return 'Logga in'
  if (profileStatus.value === 'missing') return 'Välj läktarnamn'
  return 'Konto'
})
</script>

<template>
  <div class="flex h-full flex-col px-4 pb-4 pt-6" :class="current && 'pb-24'">
    <NuxtLink :to="links.view('hem')" class="group flex items-center gap-3 px-2" aria-label="Djurgår’n tills jag dör – hem">
      <span class="stripes block h-10 w-7 rounded-md [--stripe:5px] transition-transform duration-500 ease-spring group-hover:-rotate-6" />
      <span class="leading-none">
        <span class="block font-display text-2xl font-bold tracking-tight">Djurgår’n</span>
        <span class="block font-display text-sm italic text-himmel">tills jag dör</span>
      </span>
    </NuxtLink>

    <nav class="mt-9" aria-label="Huvudmeny">
      <ul class="space-y-1">
        <li v-for="s in sections" :key="s.id">
          <NuxtLink
            :to="links.view(s.id)"
            :aria-current="links.here(s.id) ? 'page' : undefined"
            class="group relative flex items-center gap-3.5 rounded-2xl px-3 py-2.5 text-[0.95rem] font-semibold transition-colors"
            :class="links.here(s.id) ? 'bg-white/[0.07] text-krita' : 'text-krita-dim hover:bg-white/[0.04] hover:text-krita'"
          >
            <!-- The active marker: a short club stripe -->
            <span aria-hidden="true" class="stripes absolute inset-y-2 left-0 w-[3px] rounded-r-full [--stripe:4px] transition-opacity" :class="links.here(s.id) ? 'opacity-100' : 'opacity-0'" />
            <span :class="links.here(s.id) ? 'text-himmel' : ''"><NavIcon :id="s.id" /></span>
            {{ s.label }}
            <span v-if="s.id === 'lyssna' && playing" class="eq ml-auto flex h-3 items-end gap-px" aria-hidden="true">
              <span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" />
            </span>
            <span v-if="s.id === 'lyssna' && playing" class="sr-only">(spelar nu)</span>
          </NuxtLink>
        </li>
        <li v-if="status !== 'unavailable'">
          <NuxtLink
            v-if="mine"
            :to="mine"
            :aria-current="onMine ? 'page' : undefined"
            class="relative flex items-center gap-3.5 rounded-2xl px-3 py-2.5 text-[0.95rem] font-semibold transition-colors"
            :class="onMine ? 'bg-white/[0.07] text-krita' : 'text-krita-dim hover:bg-white/[0.04] hover:text-krita'"
          >
            <span aria-hidden="true" class="stripes absolute inset-y-2 left-0 w-[3px] rounded-r-full [--stripe:4px] transition-opacity" :class="onMine ? 'opacity-100' : 'opacity-0'" />
            <AccountGlyph compact class="size-5!" />
            Min läktare
          </NuxtLink>
          <!-- No place of your own yet: the way in is the account dialog -->
          <button
            v-else
            class="flex w-full items-center gap-3.5 rounded-2xl px-3 py-2.5 text-left text-[0.95rem] font-semibold text-krita-dim transition-colors hover:bg-white/[0.04] hover:text-krita"
            aria-haspopup="dialog"
            @click="accountOpen = true"
          >
            <AccountGlyph compact class="size-5!" />
            Min läktare
          </button>
        </li>
      </ul>
    </nav>

    <div class="mt-8 px-1">
      <p class="kicker px-2 text-krita-dim">Visa</p>
      <div class="mt-2 grid grid-cols-3 rounded-full border border-white/10 bg-navy-900/80 p-1 text-xs font-semibold" role="radiogroup" aria-label="Välj sport">
        <button
          v-for="o in sports"
          :key="o.value"
          role="radio"
          :aria-checked="sport === o.value"
          class="rounded-full py-1.5 transition duration-300"
          :class="sport === o.value ? 'bg-himmel text-navy-950' : 'text-krita-dim hover:text-krita'"
          @click="sport = o.value"
        >
          {{ o.label }}
        </button>
      </div>
    </div>

    <div class="mt-auto space-y-4">
      <!-- Who you are here -->
      <button
        v-if="status !== 'unavailable'"
        class="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-navy-900/60 p-2.5 text-left transition hover:border-himmel/50"
        aria-haspopup="dialog"
        @click="accountOpen = true"
      >
        <Avatar v-if="profile" :name="profile.displayName" :design="profile.avatar" size="sm" />
        <AccountGlyph v-else class="size-8 rounded-full bg-white/[0.06]" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold">{{ profile ? profile.displayName : accountLabel }}</span>
          <span v-if="profile" class="block truncate text-xs text-krita-dim">@{{ profile.handle }}</span>
          <span v-else class="block truncate text-xs text-krita-dim">{{ status === 'signed-in' ? 'Så syns du i Snacket' : 'Läs fritt, logga in för att skriva' }}</span>
        </span>
      </button>

      <p class="px-2 text-xs leading-relaxed text-krita-dim">
        <span class="font-display text-sm font-bold text-krita tabular-nums">{{ days }}</span> dagar sedan 12 mars 1891.
      </p>
      <!-- Desktop's pilot status (phones keep the banner); the full disclaimers are in the footer -->
      <p class="flex items-center gap-2 px-2 text-xs text-krita-dim">
        <span class="kicker rounded-full bg-guld px-2 py-0.5 text-navy-950">Pilot</span>
        <span aria-hidden="true">·</span>
        Ett supporterprojekt
      </p>
    </div>
  </div>
</template>

<style scoped>
.eq span { height: 45%; }
@media (prefers-reduced-motion: no-preference) {
  .eq span { animation: eq 0.9s ease-in-out infinite; }
  .eq span:nth-child(2) { animation-delay: -0.3s; }
  .eq span:nth-child(3) { animation-delay: -0.6s; }
}
@keyframes eq {
  0%, 100% { height: 30%; }
  50% { height: 100%; }
}
</style>
