import type { SupabaseClient } from '@supabase/supabase-js'
import type { NuxtApp } from '#app'
import type { PublicAuthor } from '#shared/utils/profile'
import type { MentionDirectory } from '~/lib/mentions'
import { createMentionDirectory, mentionCandidates } from '~/lib/mentions'

/*
 * @mentions on the page (see lib/mentions): one directory for the whole app,
 * fed by the posts and comments already loaded, and forgotten when the
 * account changes. `candidates` are who may be suggested while writing.
 */
type WithMentions = NuxtApp & { _mentions?: { directory: MentionDirectory, authors: ComputedRef<PublicAuthor[]> } }

export function useMentions() {
  const nuxt = useNuxtApp() as WithMentions
  const { all } = useSnacket()
  const { threads } = useInteractions()
  const { userId } = useAuth()

  if (!nuxt._mentions) {
    // The app's, not the first caller's: it outlives any one component.
    nuxt._mentions = effectScope(true).run(() => {
      // Authors on the page, most recently active first.
      const authors = computed(() => {
        const seen = [
          ...all.value.map(p => ({ author: p.author, at: p.createdAt })),
          ...Object.values(threads.value).flatMap(t => t.list.map(c => ({ author: c.author, at: c.createdAt }))),
        ]
        return seen.sort((a, b) => b.at.localeCompare(a.at)).map(s => s.author)
      })
      const client = import.meta.client ? (nuxt.$supabase as SupabaseClient | null | undefined) ?? null : null
      const directory = createMentionDirectory(client, { known: () => authors.value })
      // Someone else signed in (or out): what the last account could see is forgotten.
      if (import.meta.client) watch(useLocalOwner(), () => directory.reset())
      return { directory, authors }
    })!
  }

  const { directory, authors } = nuxt._mentions
  return {
    ...directory,
    candidates: computed(() => mentionCandidates(authors.value, userId.value)),
  }
}
