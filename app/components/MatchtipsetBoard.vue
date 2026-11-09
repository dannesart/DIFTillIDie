<script setup lang="ts">
import type { Standing } from '~/lib/matchtips'

/*
 * The season table, as the database counts it: total points, matches tipped
 * (locked, not struck), exact scores and right outcomes; equal points share a
 * rank. A pilot from its first match on, not a full-season championship.
 */
defineProps<{ standings: Standing[], ownHandle: string | null }>()
</script>

<template>
  <section aria-labelledby="mt-board">
    <h2 id="mt-board" class="font-display text-2xl font-bold">Tabellen</h2>
    <p class="mt-1 text-sm text-krita-dim">
      Pilot 2026/27: räknas från första matchen efter start, inte hela säsongen. 3 p exakt, 1 p rätt utgång efter 60 minuter, 0 p annars. Lika poäng delar placering. Bara matcher som passerat deadline räknas.
    </p>
    <div v-if="!standings.length" class="card mt-3 px-6 py-8 text-center">
      <p class="font-semibold">Ingen är med ännu</p>
      <p class="mx-auto mt-2 max-w-md text-sm text-krita-dim">Tabellen fylls när supportrar går med och matcherna spelas.</p>
    </div>
    <div v-else class="card mt-3 overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">Matchtipsets tabell, säsong 2026/27</caption>
        <thead class="text-left text-xs uppercase tracking-wider text-krita-dim">
          <tr>
            <th scope="col" class="px-3 py-3 font-semibold sm:px-4"><abbr title="Placering" class="no-underline">Pl.</abbr></th>
            <th scope="col" class="px-2 py-3 font-semibold">Supporter</th>
            <th scope="col" class="px-2 py-3 text-right font-semibold">Poäng</th>
            <th scope="col" class="px-2 py-3 text-right font-semibold"><abbr title="Tippade matcher" class="no-underline">Tippat</abbr></th>
            <th scope="col" class="hidden px-2 py-3 text-right font-semibold sm:table-cell"><abbr title="Exakt rätt (3 p)" class="no-underline">Exakt</abbr></th>
            <th scope="col" class="hidden px-4 py-3 text-right font-semibold sm:table-cell"><abbr title="Rätt utgång (1 p)" class="no-underline">Utgång</abbr></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          <tr v-for="s in standings" :key="s.handle" :class="s.handle === ownHandle ? 'bg-himmel/10 font-semibold' : ''">
            <td class="px-3 py-2.5 tabular-nums sm:px-4">{{ s.rank }}</td>
            <th scope="row" class="px-2 py-2.5 text-left font-semibold">
              <span class="block max-w-[8.5rem] truncate sm:max-w-none">@{{ s.handle }}<span v-if="s.handle === ownHandle" class="font-normal text-krita-dim"> (du)</span></span>
            </th>
            <td class="px-2 py-2.5 text-right font-display text-base font-bold tabular-nums">{{ s.points }}</td>
            <td class="px-2 py-2.5 text-right tabular-nums text-krita-dim">{{ s.tipped }}</td>
            <td class="hidden px-2 py-2.5 text-right tabular-nums text-krita-dim sm:table-cell">{{ s.exact }}</td>
            <td class="hidden px-4 py-2.5 text-right tabular-nums text-krita-dim sm:table-cell">{{ s.outcomes }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
