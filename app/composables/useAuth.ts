import type { AuthStore } from '~/lib/auth'
import { createAuth } from '~/lib/auth'

/**
 * The supporter's account. In the browser it's the real store from the auth
 * plugin; on the server it's a neutral placeholder that reports exactly what
 * the browser reports before it has checked storage ("loading"), so markup
 * matches and no personal state ever reaches server-rendered HTML.
 */
export function useAuth(): AuthStore {
  const nuxt = useNuxtApp()
  const real = nuxt.$auth as AuthStore | undefined
  if (real) return real
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  return createAuth(null, { initialStatus: supabaseUrl && supabaseKey ? 'loading' : 'unavailable' })
}

/** Is the account dialog open? (Opened from the header, the bottom nav, or after signing in.) */
export const useAccountDialog = () => useState('account-dialog-open', () => false)
