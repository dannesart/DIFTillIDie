<script setup lang="ts">
import type { SectionId } from '~/lib/sectionLinks'
import { accountEntry } from '~/lib/accountEntry'
import NavIcon from './NavIcon.vue'

/*
 * The shell's persistent sidebar: navigation and identity. The place
 * you're in, always one click from the others (the bottom nav's sections,
 * then, once you're signed in, your profile and your settings), then free
 * space, the pilot status and, last, who you are: a card that opens the
 * account menu (AccountDialog). What's going on (next match, episodes,
 * what's playing) is the rail's (ShellRail).
 *
 * The links are content-width pills: the hover and "you're here" background
 * hugs the icon and label rather than filling the column.
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
const path = computed(() => (route.path.length > 1 ? route.path.replace(/\/+$/, '') : route.path))

type Item = { key: string, icon: SectionId | 'profil' | 'installningar', label: string, to: string, here: boolean }
/*
 * Profil only once there is a profile to go to (your läktarplats, by your
 * handle); Inställningar once you're signed in. Signed out, neither: no
 * made-up profile address, nothing personal.
 */
const items = computed<Item[]>(() => {
  const list: Item[] = sections.map(s => ({ key: s.id, icon: s.id, label: s.label, to: links.value.view(s.id), here: links.value.here(s.id) }))
  const e = entry.value
  if (e.kind === 'profile') list.push({ key: 'profil', icon: 'profil', label: 'Profil', to: e.to, here: path.value === e.to })
  if (status.value === 'signed-in') list.push({ key: 'installningar', icon: 'installningar', label: 'Inställningar', to: links.value.settings, here: path.value === links.value.settings })
  return list
})

const card = 'group flex w-full items-center gap-3 rounded-full border border-white/8 bg-navy-900/60 p-2 pr-4 [--press:0.98] text-left transition hover:border-himmel/50 hover:bg-white/[0.04]'

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
      <ul class="space-y-1.5">
        <li v-for="item in items" :key="item.key">
          <NuxtLink
            :to="item.to"
            :aria-current="item.here ? 'page' : undefined"
            v-ripple="'himmel'"
            class="group relative inline-flex max-w-full items-center gap-3.5 rounded-full py-2.5 pl-3 pr-5 [--press:0.97] text-[0.95rem] font-semibold transition-colors"
            :class="item.here ? 'bg-white/[0.07] text-krita' : 'text-krita-dim hover:bg-white/[0.05] hover:text-krita'"
          >
            <span :class="item.here ? 'text-himmel' : ''"><NavIcon :id="item.icon" /></span>
            <span class="truncate">{{ item.label }}</span>
            <span v-if="item.key === 'lyssna' && playing" class="eq flex h-3 items-end gap-px" aria-hidden="true">
              <span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" />
            </span>
            <span v-if="item.key === 'lyssna' && playing" class="sr-only">(spelar nu)</span>
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
      <!--
        Who you are here: last, at the foot. The whole card opens the account
        menu (Min profil, Inställningar, Logga ut); signed out
        or choosing a name, the same dialog lets you in. Your läktarplats is
        the "Profil" link above.
        Two elements, not one with changing insides: the server renders the
        signed-out one, and a single shared button didn't follow a later
        sign-out (it kept showing your name).
      -->
      <button
        v-if="entry.kind === 'profile' && profile"
        type="button"
        v-ripple="'himmel'"
        :class="card"
        aria-haspopup="dialog"
        @click="accountOpen = true"
      >
        <Avatar :name="profile.displayName" :design="profile.avatar" size="sm" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold">{{ profile.displayName }}</span>
          <span class="block truncate text-xs text-krita-dim">@{{ profile.handle }}</span>
          <span class="sr-only">– kontomeny</span>
        </span>
        <svg viewBox="0 0 24 24" class="size-5 shrink-0 text-krita-dim transition-colors group-hover:text-krita" fill="currentColor" aria-hidden="true">
          <circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" />
        </svg>
      </button>
      <!-- Signed out, choosing a name, or still loading: the same dialog, to sign in or pick a name -->
      <button
        v-else-if="entry.kind === 'dialog'"
        type="button"
        v-ripple="'himmel'"
        :class="card"
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
