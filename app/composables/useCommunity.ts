import type { CommunityStore } from '~/lib/posts'
import { createCommunity } from '~/lib/posts'

/**
 * Real Snacket posts. In the browser it's the store from the auth plugin; on
 * the server a neutral placeholder in the same first state the browser starts
 * in, so markup matches and the cached HTML never carries posts or sessions.
 */
export function useCommunity(): CommunityStore {
  const nuxt = useNuxtApp()
  const real = nuxt.$community as CommunityStore | undefined
  if (real) return real
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  return createCommunity(null, null, { initialStatus: supabaseUrl && supabaseKey ? 'idle' : 'unavailable' })
}
