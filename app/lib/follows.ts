import type { SupabaseClient } from '@supabase/supabase-js'
import { ref, watch } from 'vue'
import type { PublicAuthor } from '#shared/utils/profile'
import { toAuthor } from '#shared/utils/profile'
import type { AuthStore } from './auth'

/*
 * Following supporters (#9), private in v1: only you can see whom you follow.
 * The database decides everything that matters (only public supporters, never
 * yourself, one follow per pair, your rows only); this store asks it and shows
 * the answer. A follow shows as made only once Supabase has confirmed it.
 *
 * 'unavailable': a database without the follows migration (no such table or
 * function). Retrying can't help, so the page shows no follow controls at all.
 */

export type FollowsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'

interface DataError { code?: string, message?: string }
const code = (e: unknown) => (e as DataError | null)?.code ?? ''
/** No such table (42P01, PGRST205) or function (42883, PGRST202): the migration isn't there yet. */
export const followsMissing = (e: unknown) => ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(code(e))

export function followErrorMessage(e: unknown): string {
  switch (code(e)) {
    case 'P0002': return 'Den här supportern går inte att följa just nu.'
    case '23514': return 'Du kan inte följa dig själv.'
    case '42501': return 'Logga in och välj ditt läktarnamn för att följa.'
    default: return 'Det gick inte. Försök igen.'
  }
}

interface FollowedRow { id: string, display_name: string, handle: string, avatar: string | null }

export function createFollows(client: SupabaseClient | null, auth: AuthStore | null) {
  /** Whether the database has following at all ('unavailable' once it's known not to). */
  const status = ref<FollowsStatus>('idle')
  /** Whom you follow, by user id, as confirmed by Supabase (absent = not checked yet). */
  const following = ref<Record<string, boolean>>({})
  /** Supporters with a follow or unfollow on its way. */
  const pending = ref<Record<string, boolean>>({})
  /** Your own list ("Du följer"): public supporters you follow, newest follow first. */
  const list = ref<PublicAuthor[]>([])
  const listStatus = ref<FollowsStatus>('idle')
  let request = 0

  const canFollow = () => !!client && !!auth && auth.status.value === 'signed-in' && auth.profileStatus.value === 'ready'
  const set = <T>(r: { value: Record<string, T> }, id: string, v: T | undefined) => {
    const { [id]: _, ...rest } = r.value
    r.value = v === undefined ? rest : { ...rest, [id]: v }
  }
  const missing = () => {
    status.value = 'unavailable'
    listStatus.value = 'unavailable'
  }

  /**
   * Do you follow this supporter? Your own rows are all the database lets you read.
   * Signed out there's nothing to ask (signed-out visitors can't read follows at all,
   * so any request would only fail): "Följ" shows, and tapping it invites you in.
   */
  async function check(profileId: string) {
    const uid = auth?.userId.value
    if (!client || status.value === 'unavailable') return
    if (!uid) {
      status.value = 'ready'
      return
    }
    const mine = request
    try {
      const { data, error: e } = await client.from('supporter_follows').select('followed_id').eq('followed_id', profileId).maybeSingle()
      if (mine !== request) return
      if (e) throw e
      set(following, profileId, !!data)
      status.value = 'ready'
    }
    catch (e) {
      if (mine !== request) return
      if (followsMissing(e)) return missing()
      // Couldn't tell: settle on "not followed", so "Följ" stays usable rather than
      // disabled (or hidden) for good. Safe because following is idempotent: if you
      // did follow them, tapping "Följ" changes nothing and then shows "Följer".
      // Unfollowing is only offered once a follow has been confirmed.
      set(following, profileId, false)
      status.value = 'ready'
    }
  }

  /** Follow, or (when you already do) stop following. */
  async function toggle(profileId: string): Promise<{ ok: true } | { ok: false, message: string }> {
    if (!canFollow()) return { ok: false, message: 'Logga in och välj ditt läktarnamn för att följa.' }
    if (pending.value[profileId]) return { ok: false, message: 'Ett ögonblick…' }
    const follow = !following.value[profileId]
    set(pending, profileId, true)
    try {
      const { error: e } = await client!.rpc(follow ? 'follow_supporter' : 'unfollow_supporter', { p_profile_id: profileId })
      if (e) throw e
      set(following, profileId, follow)
      // Your list follows suit: gone at once, or there the next time it's shown.
      if (!follow) list.value = list.value.filter(p => p.id !== profileId)
      else if (listStatus.value === 'ready') listStatus.value = 'idle'
      return { ok: true }
    }
    catch (e) {
      if (followsMissing(e)) missing()
      return { ok: false, message: followErrorMessage(e) }
    }
    finally {
      set(pending, profileId, undefined)
    }
  }

  /** "Du följer": only public supporters (the database hides anyone who has become private). */
  async function loadList() {
    const uid = auth?.userId.value
    if (!client || !uid || listStatus.value === 'unavailable') return
    const mine = request
    if (listStatus.value !== 'ready') listStatus.value = 'loading'
    try {
      const { data, error: e } = await client.rpc('followed_supporters')
      if (mine !== request) return
      if (e) throw e
      list.value = ((data ?? []) as FollowedRow[]).map(toAuthor)
      for (const p of list.value) set(following, p.id, true)
      listStatus.value = 'ready'
      status.value = 'ready'
    }
    catch (e) {
      if (mine !== request) return
      if (followsMissing(e)) missing()
      else listStatus.value = 'error'
    }
  }

  // Follows belong to whoever is signed in: forget them when that changes.
  if (auth) {
    watch(auth.userId, () => {
      request++
      following.value = {}
      pending.value = {}
      list.value = []
      if (status.value !== 'unavailable') {
        status.value = 'idle'
        listStatus.value = 'idle'
      }
    })
  }

  return { status, following, pending, list, listStatus, canFollow, check, toggle, loadList }
}

export type FollowsStore = ReturnType<typeof createFollows>
