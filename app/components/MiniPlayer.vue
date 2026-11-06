<script setup lang="ts">
/*
 * Follows the supporter around the page while an episode is playing (or
 * paused mid-listen) and the main player is scrolled out of view.
 * It drives the same <audio> element as the main player.
 */
const { current, currentShow, showTitle, playing, position, duration, progress, playerInView, selectedShow, toggle, seekFromClick, seekFromKey, stop } = usePodcastPlayer()

// On phones, step aside while someone is typing (the keyboard needs the space).
const typing = useTyping()
const small = useMedia('(max-width: 639px)')

const visible = computed(() => !!current.value && !playerInView.value && !(typing.value && small.value))

// Back to the playing show's own player — switching the picker to it if needed.
// (In the app-shell prototype "Lyssna" is a view of its own: go there.)
const links = useSectionLinks()
function backToPlayer() {
  if (currentShow.value) selectedShow.value = currentShow.value.id
  const el = document.getElementById('lyssna')
  if (!el && links.value.shell) return void navigateTo(links.value.section('lyssna'))
  el?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <!-- Keeps the footer from hiding under the player at the very bottom of the page -->
  <div v-if="current" aria-hidden="true" class="h-[4.5rem]" />

  <Transition
    enter-active-class="transition duration-500 ease-out-expo"
    enter-from-class="opacity-0 motion-safe:translate-y-6"
    leave-active-class="transition duration-300 ease-in"
    leave-to-class="opacity-0 motion-safe:translate-y-6"
  >
    <aside
      v-if="visible && current"
      class="fixed inset-x-2 bottom-[calc(var(--nav-h)+0.5rem)] z-40 sm:inset-x-auto sm:bottom-[calc(var(--nav-h)+1.5rem)] sm:right-6 sm:w-[23rem]"
      :class="links.shell && 'lg:bottom-3 lg:left-3 lg:right-auto lg:w-[calc(var(--shell-nav-w)-1.5rem)]'"
      aria-label="Spelare"
    >
      <div class="relative overflow-hidden rounded-2xl border border-white/10 bg-navy-900/90 shadow-[0_24px_60px_-24px_rgb(3_9_21/0.95)] backdrop-blur-xl">
        <div class="flex items-center gap-3 py-2 pl-2 pr-2.5">
          <button class="group flex min-w-0 flex-1 items-center gap-3 text-left" :title="`Till spelaren: ${current.title}`" @click="backToPlayer">
            <!-- Tiny night-sky tile; the bars dance while it plays -->
            <span class="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[radial-gradient(circle_at_70%_25%,#1b3c7c_0%,#0a1b3d_55%,#030915_100%)]">
              <span v-if="!playing" class="absolute right-1.5 top-1.5 size-3 rounded-full bg-guld">
                <span class="absolute -left-1 -top-0.5 size-3 rounded-full bg-[#0f2550]" />
              </span>
              <span v-else class="eq flex h-4 items-end gap-[3px]" aria-hidden="true">
                <span class="w-[3px] rounded-full bg-guld" /><span class="w-[3px] rounded-full bg-guld" /><span class="w-[3px] rounded-full bg-guld" />
              </span>
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold group-hover:underline decoration-himmel/60 underline-offset-2">{{ current.title }}</span>
              <span class="block truncate text-xs tabular-nums text-krita-dim">
                {{ showTitle }} · {{ clock(position) }}<template v-if="duration"> / {{ clock(duration) }}</template>
              </span>
            </span>
          </button>

          <button
            class="grid size-10 shrink-0 place-items-center rounded-full bg-guld text-navy-950 transition hover:scale-105 active:scale-95"
            :aria-label="playing ? `Pausa ${current.title}` : `Spela ${current.title}`"
            @click="toggle()"
          >
            <svg v-if="playing" viewBox="0 0 24 24" class="size-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            <svg v-else viewBox="0 0 24 24" class="ml-0.5 size-4" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
          </button>
          <button class="grid size-8 shrink-0 place-items-center rounded-full text-krita-dim transition hover:bg-white/10 hover:text-krita" aria-label="Stäng spelaren (pausar)" @click="stop">
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <!-- Progress: a thin stripe, with a taller invisible hit area for seeking -->
        <div
          class="absolute inset-x-0 bottom-0 flex h-3 cursor-pointer items-end"
          role="slider"
          tabindex="0"
          aria-label="Position i avsnittet"
          :aria-valuenow="Math.round(position)"
          :aria-valuemax="Math.round(duration)"
          :aria-valuetext="`${clock(position)} av ${clock(duration)}`"
          @click="seekFromClick"
          @keydown="seekFromKey"
        >
          <div class="h-[3px] w-full bg-white/10">
            <div class="stripes h-full [--stripe:6px]" :style="{ width: `${progress}%` }" />
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.eq span { height: 40%; }
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
