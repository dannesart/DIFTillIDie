<script setup lang="ts">
/* A slow marquee of what's being said right now in Snacket. */
const { all } = useSnacket()
const items = computed(() =>
  [...all.value]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)
    .map(p => ({ id: p.id, handle: p.author.handle, text: p.body.length > 90 ? `${p.body.slice(0, 88)}…` : p.body })),
)
const paused = ref(false)
</script>

<template>
  <a
    href="#snacket"
    class="group relative block overflow-hidden border-y border-white/8 bg-navy-900/60 py-3"
    aria-label="Snacket just nu – gå till Snacket på stan"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
  >
    <div class="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center bg-gradient-to-r from-navy-950 via-navy-950 to-transparent pl-4 pr-10 sm:pl-6">
      <span class="kicker flex items-center gap-2 text-guld">
        <span class="relative flex size-2"><span class="absolute inline-flex size-full animate-ping rounded-full bg-rod opacity-75" /><span class="relative inline-flex size-2 rounded-full bg-rod" /></span>
        Snacket just nu
      </span>
    </div>
    <div class="flex w-max" :style="{ animation: 'marquee 60s linear infinite', animationPlayState: paused ? 'paused' : 'running' }">
      <div v-for="copy in 2" :key="copy" class="flex shrink-0 items-center" :aria-hidden="copy === 2">
        <span v-for="item in items" :key="`${copy}-${item.id}`" class="flex items-center whitespace-nowrap pl-10 text-sm">
          <span class="font-semibold text-himmel">@{{ item.handle }}</span>
          <span class="ml-2 text-krita-dim group-hover:text-krita">{{ item.text }}</span>
          <span class="ml-10 text-guld/60">★</span>
        </span>
      </div>
    </div>
  </a>
</template>
