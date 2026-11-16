import type { SupabaseClient } from '@supabase/supabase-js'
import type { FollowsStore } from '~/lib/follows'
import { createFollows } from '~/lib/follows'
import { createFollowingFeed } from '~/lib/followingFeed'

/**
 * Following supporters (private: only you see whom you follow). In the browser
 * it's the store from the auth plugin; on the server an empty placeholder, so
 * no one's follows ever reach server-rendered (cached) HTML.
 */
export function useFollows(): FollowsStore {
  const real = useNuxtApp().$follows as FollowsStore | undefined
  return real ?? createFollows(null, null)
}

/**
 * Snacket's Följer: posts by the supporters you follow (lib/followingFeed).
 * One per Snacket page, loaded in the browser only; on the server an empty
 * store in 'idle', so cached HTML never carries anyone's follows.
 */
export function useFollowingFeed() {
  const nuxt = useNuxtApp()
  const client = nuxt.$supabase as SupabaseClient | null | undefined
  return createFollowingFeed(client ?? null, (nuxt.$auth as ReturnType<typeof useAuth> | undefined) ?? null)
}
