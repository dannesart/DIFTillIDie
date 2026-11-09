import type { SupabaseClient } from '@supabase/supabase-js'
import { createMatchtips } from '~/lib/matchtips'

/**
 * Matchtipset for the page you're on (lib/matchtips). Loaded in the browser
 * only, like a supporter's wall, so server-rendered HTML never carries it;
 * on the server it's an empty store in 'idle'.
 */
export function useMatchtips() {
  const client = useNuxtApp().$supabase as SupabaseClient | null | undefined
  return createMatchtips(client ?? null, import.meta.client ? useAuth() : null)
}
