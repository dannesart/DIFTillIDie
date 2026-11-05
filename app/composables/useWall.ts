import type { SupabaseClient } from '@supabase/supabase-js'
import { createWall } from '~/lib/wall'

/**
 * A supporter's profile and wall, for /laktaren/<handle>. Loaded in the browser
 * only (like the feed), so cached HTML never carries it. On the server, and
 * before load(), it is an empty store in 'idle'.
 */
export function useWall(address: string) {
  const client = useNuxtApp().$supabase as SupabaseClient | null | undefined
  return createWall(client ?? null, address)
}

/**
 * A supporter's public address: their handle. Only an address; who they are
 * is their user id. After a handle change, the old address still leads to
 * them (an alias), and so do the older /laktaren/<user id> links.
 */
export const supporterPath = (handle: string) => `/laktaren/${handle}`
