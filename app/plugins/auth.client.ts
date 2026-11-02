import { createClient } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, createAuth } from '~/lib/auth'

/*
 * Supporter sign-in (six-digit e-mail code), browser only. The session lives
 * in this browser's storage and is never sent to our server, so
 * server-rendered (and CDN-cached) HTML is identical for everyone.
 */
export default defineNuxtPlugin(() => {
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  const client = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Codes are verified in-page; nothing ever arrives via the URL.
          detectSessionInUrl: false,
          storageKey: AUTH_STORAGE_KEY,
        },
      })
    : null

  const auth = createAuth(client)
  void auth.init()
  return { provide: { auth } }
})
