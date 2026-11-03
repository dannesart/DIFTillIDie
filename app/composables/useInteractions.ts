import type { InteractionsStore } from '~/lib/interactions'
import { createInteractions } from '~/lib/interactions'

/**
 * Real reactions and comments. In the browser it's the store from the auth
 * plugin; on the server an empty placeholder, so the cached HTML never holds
 * counts, comments or anyone's reactions and the browser's first render matches.
 */
export function useInteractions(): InteractionsStore {
  const real = useNuxtApp().$interactions as InteractionsStore | undefined
  return real ?? createInteractions(null, null, null)
}
