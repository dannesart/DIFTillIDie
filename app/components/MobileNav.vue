<script setup lang="ts">
/*
 * Bottom navigation for phones and tablets (the header's links only show
 * from lg up). On the front page, plain in-page anchors with a scroll-spy
 * for the active section; elsewhere (a supporter's page) the same items lead
 * back to those sections. The podcast player lives in app.vue, so it keeps
 * playing either way.
 */
type Section = 'hem' | 'stories' | 'snacket' | 'lyssna'
const items: { id: Section, label: string }[] = [
  { id: 'hem', label: 'Hem' },
  { id: 'stories', label: 'Stories' },
  { id: 'snacket', label: 'Snacket' },
  { id: 'lyssna', label: 'Lyssna' },
]

const active = ref<Section>('hem')
const route = useRoute()
const onHome = computed(() => route.path === '/')
const { status: authStatus, profile } = useAuth()
const accountOpen = useAccountDialog()
const hasAccount = computed(() => authStatus.value !== 'unavailable')
const { playing } = usePodcastPlayer()
const typing = useTyping()
const desktop = useMedia('(min-width: 1024px)')
// The keyboard needs the space while typing on a phone or tablet.
const hidden = computed(() => typing.value && !desktop.value)

// Scroll-spy: the active section is the last one whose top has passed a line
// a third of the way down the screen. Paused briefly after a tap so a smooth
// scroll past other sections doesn't make the highlight flicker.
let lockedUntil = 0
let frame = 0
function spy() {
  frame = 0
  if (Date.now() < lockedUntil) return
  const line = window.innerHeight * 0.33
  let current: Section = 'hem'
  for (const { id } of items.slice(1)) {
    const el = document.getElementById(id)
    if (el && el.getBoundingClientRect().top <= line) current = id
  }
  active.value = current
}
const onScroll = () => (frame ||= requestAnimationFrame(spy))
const unlock = () => {
  lockedUntil = 0
  spy()
}

onMounted(() => {
  spy()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('scrollend', unlock)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('scrollend', unlock)
  cancelAnimationFrame(frame)
})

function go(id: Section) {
  if (!onHome.value) {
    void navigateTo(id === 'hem' ? '/' : `/#${id}`)
    return
  }
  active.value = id
  lockedUntil = Date.now() + 1200
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const el = document.getElementById(id)
  if (id === 'hem') window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
  else el?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  // Keep the address shareable without stacking history entries.
  history.replaceState(history.state, '', id === 'hem' ? location.pathname + location.search : `#${id}`)
  // Move keyboard/screen-reader focus to the section, without a second jump.
  if (el) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  }
}
</script>

<template>
  <!-- Keeps the footer clear of the bar -->
  <div aria-hidden="true" class="h-[var(--nav-h)] lg:hidden" />

  <nav
    aria-label="Huvudmeny"
    class="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-navy-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl transition-transform duration-300 lg:hidden"
    :class="hidden && 'translate-y-full'"
    :inert="hidden || undefined"
  >
    <ul class="mx-auto grid h-16 max-w-xl" :class="hasAccount ? 'grid-cols-6' : 'grid-cols-5'">
      <li v-for="item in items" :key="item.id">
        <a
          :href="(onHome ? '' : '/') + (item.id === 'hem' ? '#' : `#${item.id}`)"
          :aria-current="onHome && active === item.id ? 'location' : undefined"
          class="relative flex h-full flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold transition-colors motion-safe:active:scale-95"
          :class="onHome && active === item.id ? 'text-himmel' : 'text-krita-dim hover:text-krita'"
          @click.prevent="go(item.id)"
        >
          <!-- Active marker: a short stripe, like the club's -->
          <span
            aria-hidden="true"
            class="stripes absolute top-0 h-[3px] w-8 rounded-b-full [--stripe:4px] transition-opacity duration-300"
            :class="onHome && active === item.id ? 'opacity-100' : 'opacity-0'"
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
        </a>
      </li>
      <!-- Matchtipset: its own page, not a front-page section -->
      <li>
        <NuxtLink
          to="/matchtipset"
          :aria-current="route.path === '/matchtipset' ? 'page' : undefined"
          class="relative flex h-full flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold transition-colors motion-safe:active:scale-95"
          :class="route.path === '/matchtipset' ? 'text-himmel' : 'text-krita-dim hover:text-krita'"
        >
          <span aria-hidden="true" class="stripes absolute top-0 h-[3px] w-8 rounded-b-full [--stripe:4px] transition-opacity duration-300" :class="route.path === '/matchtipset' ? 'opacity-100' : 'opacity-0'" />
          <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 9.5h3M13 9.5h3M8 14.5l2 2 4-4.5" />
          </svg>
          Tipset
        </NuxtLink>
      </li>
      <!-- Your account: opens the account dialog (not a section) -->
      <li v-if="hasAccount">
        <button
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
