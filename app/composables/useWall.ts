import type { SupabaseClient } from '@supabase/supabase-js'
import { createWall } from '~/lib/wall'

/**
 * A supporter's profile and wall, for /laktaren/<id>. Loaded in the browser
 * only (like the feed), so cached HTML never carries it. On the server, and
 * before load(), it is an empty store in 'idle'.
 */
export function useWall(id: string) {
  const client = useNuxtApp().$supabase as SupabaseClient | null | undefined
  return createWall(client ?? null, id)
}

/** Where a supporter lives: by their user id, which never changes (unlike the handle). */
export const supporterPath = (id: string) => `/laktaren/${id}`
