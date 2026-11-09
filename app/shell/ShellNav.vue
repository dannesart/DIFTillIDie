<script setup lang="ts">
import type { SectionId } from '~/lib/sectionLinks'
import { accountEntry } from '~/lib/accountEntry'
import NavIcon from './NavIcon.vue'

/*
 * The shell's persistent sidebar: navigation and identity. The place
 * you're in, always one click from the others (the bottom nav's sections),
 * then free space, the pilot status and, last, who you are. What's going on
 * (next match, episodes, what's playing) is the rail's (ShellRail).
 */
const route = useRoute()
const links = useSectionLinks()
const { status, profile, profileStatus } = useAuth()
const accountOpen = useAccountDialog()
const { playing } = usePodcastPlayer()

const sections: { id: SectionId, label: string }[] = [
  { id: 'hem', label: 'Hem' },
  { id: 'snacket', label: 'Snacket' },
  { id: 'stories', label: 'Stories' },
  { id: 'lyssna', label: 'Lyssna' },
]

const entry = computed(() => accountEntry(status.value, profileStatus.value, profile.value?.handle, links.value.supporter))
const onMine = computed(() => entry.value.kind === 'profile' && route.path === entry.value.to)
const accountLabel = computed(() => {
  if (status.value !== 'signed-in') return 'Logga in'
  if (profileStatus.value === 'missing') return 'Välj läktarnamn'
  return 'Konto'
})
</script>

<template>
  <!-- min-h-full: a short window makes the sidebar scroll rather than squeeze or overlap -->
  <div class="flex min-h-full flex-col px-4 pb-4 pt-6">
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
      </ul>
    </nav>

    <div class="mt-auto space-y-4 pt-8">
      <!-- Desktop's pilot status (phones keep the banner); the full disclaimers are in the footer -->
      <p class="flex items-center gap-2 px-2 text-xs text-krita-dim">
        <span class="kicker rounded-full bg-guld px-2 py-0.5 text-navy-950">Pilot</span>
        <span aria-hidden="true">·</span>
        Ett supporterprojekt
      </p>
      <!-- Who you are here: last, at the foot. With a profile it's the way to your läktarplats, and beside it (never inside) your settings (Issue #14). -->
      <div v-if="entry.kind === 'profile' && profile" class="flex items-center gap-2">
        <NuxtLink
          :to="entry.to"
          :aria-current="onMine ? 'page' : undefined"
          class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-navy-900/60 p-2.5 transition hover:border-himmel/50"
          :class="onMine ? 'border-himmel/50' : 'border-white/8'"
        >
          <Avatar :name="profile.displayName" :design="profile.avatar" size="sm" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ profile.displayName }}</span>
            <span class="block truncate text-xs text-krita-dim">@{{ profile.handle }}</span>
          </span>
        </NuxtLink>
        <AccountSettingsButton />
      </div>
      <!-- Signed out, choosing a name, or still loading: the account dialog -->
      <button
        v-else-if="entry.kind === 'dialog'"
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
