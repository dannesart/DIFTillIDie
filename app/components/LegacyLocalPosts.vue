<script setup lang="ts">
/*
 * Posts this visitor wrote before Snacket became real. They were only ever
 * saved in this browser, so they stay here: never published, never counted,
 * never mixed into the feed. Collapsed by default; the writer can read them
 * or remove them one by one. Nothing here can publish.
 */
const { legacy, removeLegacy } = useSnacket()
const { stories } = useNews()

const storyFor = (id?: string) => (id ? stories.value.find(s => storyAnswersTo(s, id)) : undefined)

const confirming = ref<string | null>(null)
const failed = ref<string | null>(null)
function remove(id: string) {
  failed.value = removeLegacy(id) ? null : id
  confirming.value = null
}
</script>

<template>
  <details v-if="legacy.length" class="group card mt-10 p-0">
    <summary class="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true">🔒</span>
      <span class="min-w-0 flex-1">
        <span class="font-semibold">{{ legacy.length === 1 ? 'Ditt gamla inlägg' : `Dina ${legacy.length} gamla inlägg` }}</span>
        <span class="text-krita-dim"> · Bara på den här enheten</span>
      </span>
      <span class="text-krita-dim transition group-open:rotate-180" aria-hidden="true">⌄</span>
    </summary>
    <div class="border-t border-white/8 px-5 pb-5 pt-4">
      <p class="text-xs leading-relaxed text-krita-dim">
        Du skrev {{ legacy.length === 1 ? 'det' : 'dem' }} innan Snacket blev på riktigt.
        {{ legacy.length === 1 ? 'Det har' : 'De har' }} aldrig publicerats, syns inte för någon annan och räknas inte i Snacket.
      </p>
      <ul class="mt-4 space-y-3">
        <li v-for="p in legacy" :key="p.id" class="rounded-2xl border border-dashed border-white/15 bg-navy-950/40 p-4">
          <p class="flex flex-wrap items-center gap-x-2 text-xs text-krita-dim">
            <span class="rounded-full border border-white/15 px-2 py-0.5 font-semibold">Bara på den här enheten</span>
            <TimeAgo v-if="p.createdAt" :at="p.createdAt" />
            <span v-if="p.sport" class="capitalize">· {{ p.sport }}</span>
            <span v-if="storyFor(p.storyId)" class="truncate">· Om: {{ leadOf(storyFor(p.storyId)!).headline }}</span>
          </p>
          <p class="mt-2 whitespace-pre-line text-sm leading-relaxed">{{ p.body }}</p>
          <ul v-if="p.comments.length" class="mt-3 space-y-1.5 border-l-2 border-white/10 pl-3">
            <li v-for="c in p.comments" :key="c.id" class="text-xs"><span class="font-semibold">{{ c.authorName }}:</span> <span class="text-krita-dim">{{ c.body }}</span></li>
          </ul>
          <div class="mt-3 flex justify-end gap-3 text-xs">
            <template v-if="confirming === p.id">
              <button class="font-bold text-rod hover:underline" @click="remove(p.id)">Ja, ta bort från enheten</button>
              <button class="text-krita-dim hover:text-krita" @click="confirming = null">Avbryt</button>
            </template>
            <button v-else class="text-krita-dim hover:text-rod" @click="confirming = p.id">Ta bort</button>
          </div>
          <p v-if="failed === p.id" class="mt-1 text-right text-xs font-semibold text-rod" role="alert">Kunde inte ta bort det här.</p>
        </li>
      </ul>
    </div>
  </details>
</template>
