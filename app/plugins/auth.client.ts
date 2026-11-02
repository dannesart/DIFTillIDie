import { createClient } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, createAuth } from '~/lib/auth'

/*
 * Supporter sign-in, browser only. The session lives in this browser's
 * storage and is never sent to our server, so server-rendered (and
 * CDN-cached) HTML is identical for everyone.
 */
export default defineNuxtPlugin(() => {
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  const client = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          // /auth/callback exchanges the code itself, with proper error handling.
          detectSessionInUrl: false,
          storageKey: AUTH_STORAGE_KEY,
        },
      })
    : null

  const auth = createAuth(client, { origin: window.location.origin })
  void auth.init()
  return { provide: { auth } }
})
