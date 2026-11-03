import { createClient } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, createAuth } from '~/lib/auth'
import { createCommunity } from '~/lib/posts'

/*
 * Supporter sign-in (six-digit e-mail code) and real Snacket posts, browser
 * only. The session lives in this browser's storage and is never sent to our
 * server, so server-rendered (and CDN-cached) HTML is identical for everyone.
 * Posts are read client-side too: public, but always fresh.
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
  const community = createCommunity(client, auth)

  // Back on the tab after a while (e.g. the other phone just posted): fetch again.
  document.addEventListener('visibilitychange', () => {
    const at = community.loadedAt.value
    if (document.visibilityState === 'visible' && at && Date.now() - at > 60_000) void community.refresh()
  })

  return { provide: { auth, community } }
})
