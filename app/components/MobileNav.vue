<script setup lang="ts">
import type { SectionId } from '~/lib/sectionLinks'
import { accountEntry } from '~/lib/accountEntry'

/*
 * Bottom navigation for phones and tablets: the site's pages, the same
 * addresses as desktop's sidebar (Issue #16). The active tab is the page
 * you're on, by its address. The podcast player lives in app.vue, outside
 * the pages, so it keeps playing from page to page; where focus goes after
 * a tap is the shell's (AppShell).
 */
const items: { id: SectionId, label: string }[] = [
  { id: 'hem', label: 'Hem' },
  { id: 'stories', label: 'Stories' },
  { id: 'snacket', label: 'Snacket' },
  { id: 'lyssna', label: 'Lyssna' },
]

const route = useRoute()
const { status: authStatus, profile, profileStatus } = useAuth()
const accountOpen = useAccountDialog()
const links = useSectionLinks()
const entry = computed(() => accountEntry(authStatus.value, profileStatus.value, profile.value?.handle, links.value.supporter))
const hasAccount = computed(() => entry.value.kind !== 'none')
const onMine = computed(() => entry.value.kind === 'profile' && route.path === entry.value.to)
const { playing } = usePodcastPlayer()
const typing = useTyping()
const desktop = useMedia('(min-width: 1024px)')
// The keyboard needs the space while typing on a phone or tablet.
const hidden = computed(() => typing.value && !desktop.value)

// The page you're already on: a tap takes you back to its top (html scrolls smoothly, or not under reduced motion).
function tap(e: MouseEvent, id: SectionId) {
  if (!links.value.here(id) || route.hash) return
  e.preventDefault()
  window.scrollTo({ top: 0 })
}
</script>

<template>
  <!-- Keeps the footer clear of the bar -->
  <div aria-hidden="true" class="h-[var(--nav-h)] lg:hidden" />

  <nav
    aria-label="Huvudmeny"
    data-nav-focus
    class="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-navy-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl transition-transform duration-300 lg:hidden"
    :class="hidden && 'translate-y-full'"
    :inert="hidden || undefined"
  >
    <ul class="mx-auto grid h-16 max-w-xl" :class="hasAccount ? 'grid-cols-5' : 'grid-cols-4'">
      <li v-for="item in items" :key="item.id">
        <NuxtLink
          :to="links.view(item.id)"
          :aria-current="links.here(item.id) ? 'page' : undefined"
          class="relative flex h-full flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold transition-colors motion-safe:active:scale-95"
          :class="links.here(item.id) ? 'text-himmel' : 'text-krita-dim hover:text-krita'"
          @click="tap($event, item.id)"
        >
          <!-- Active marker: a short stripe, like the club's -->
          <span
            aria-hidden="true"
            class="stripes absolute top-0 h-[3px] w-8 rounded-b-full [--stripe:4px] transition-opacity duration-300"
            :class="links.here(item.id) ? 'opacity-100' : 'opacity-0'"
          />

          <span class="relative grid size-6 place-items-center" aria-hidden="true">
            <!-- Hem: the stripes -->
            <svg v-if="item.id === 'hem'" viewBox="0 0 24 24" class="size-6" fill="currentColor">
              <rect x="4" y="3" width="4" height="18" rx="1.5" /><rect x="10" y="3" width="4" height="18" rx="1.5" opacity=".55" /><rect x="16" y="3" width="4" height="18" rx="1.5" />
            </svg>
            <!-- Stories: a front page -->
            <svg v-else-if="item.id === 'stories'" viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M7 8.5h10M7 12h6M7 15.5h6" /><rect x="14.5" y="11.5" width="2.5" height="4.5" rx=".6" fill="currentColor" stroke="none" />
            </svg>
            <!-- Snacket: a speech bubble -->
            <svg v-else-if="item.id === 'snacket'" viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
              <path d="M4 5h16v11H10l-5 4v-4H4z" /><circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="10.5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="10.5" r="1" fill="currentColor" stroke="none" />
            </svg>
            <!-- Lyssna: headphones -->
            <svg v-else viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3.5" y="13.5" width="4.5" height="6.5" rx="1.8" /><rect x="16" y="13.5" width="4.5" height="6.5" rx="1.8" />
            </svg>
            <!-- Something is playing: say where the sound lives -->
            <span v-if="item.id === 'lyssna' && playing" class="eq absolute -right-2 -top-1 flex h-2.5 items-end gap-px rounded-sm bg-navy-950 px-0.5">
              <span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" /><span class="w-[2px] rounded-full bg-guld" />
            </span>
          </span>
          {{ item.label }}
          <span v-if="item.id === 'lyssna' && playing" class="sr-only">(spelar nu)</span>
        </NuxtLink>
      </li>
      <!-- You: your läktarplats once you have a profile (the account dialog is on it), until then the account dialog -->
      <li v-if="hasAccount">
        <NuxtLink
          v-if="entry.kind === 'profile'"
          :to="entry.to"
          :aria-current="onMine ? 'page' : undefined"
          class="relative flex h-full flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold transition-colors motion-safe:active:scale-95"
          :class="onMine ? 'text-himmel' : 'text-krita-dim hover:text-krita'"
        >
          <span
            aria-hidden="true"
            class="stripes absolute top-0 h-[3px] w-8 rounded-b-full [--stripe:4px] transition-opacity duration-300"
            :class="onMine ? 'opacity-100' : 'opacity-0'"
          />
          <AccountGlyph compact class="size-6" />
          Du
        </NuxtLink>
        <button
          v-else
          class="relative flex h-full w-full flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold text-krita-dim transition-colors hover:text-krita motion-safe:active:scale-95"
          aria-haspopup="dialog"
          @click="accountOpen = true"
        >
          <AccountGlyph compact class="size-6" />
          {{ authStatus === 'signed-in' ? 'Du' : 'Logga in' }}
          <span v-if="authStatus === 'signed-in' && !profile" class="sr-only">(slutför din profil)</span>
        </button>
      </li>
    </ul>
  </nav>
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
