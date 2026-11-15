import type { FollowsStore } from '~/lib/follows'
import { createFollows } from '~/lib/follows'

/**
 * Following supporters (private: only you see whom you follow). In the browser
 * it's the store from the auth plugin; on the server an empty placeholder, so
 * no one's follows ever reach server-rendered (cached) HTML.
 */
export function useFollows(): FollowsStore {
  const real = useNuxtApp().$follows as FollowsStore | undefined
  return real ?? createFollows(null, null)
}
