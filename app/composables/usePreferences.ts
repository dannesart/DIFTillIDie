import type { PreferencesStore } from '~/lib/preferences'
import { createPreferences } from '~/lib/preferences'

/**
 * The signed-in supporter's own team interests. In the browser it's the store
 * from the auth plugin; on the server an empty placeholder, so they never
 * reach server-rendered (cached) HTML.
 */
export function usePreferences(): PreferencesStore {
  const real = useNuxtApp().$preferences as PreferencesStore | undefined
  return real ?? createPreferences(null, null)
}
