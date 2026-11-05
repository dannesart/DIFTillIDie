import type { SupabaseClient } from '@supabase/supabase-js'
import { ref, watch } from 'vue'
import type { TeamInterest } from '#shared/utils/profile'
import { isTeamInterest, TEAM_INTERESTS } from '#shared/utils/profile'
import type { AuthStore } from './auth'

/*
 * The signed-in supporter's own team interests (fotboll:herr, hockey:dam, …).
 * Only they can read or change them; the database makes sure of it. They are
 * shown on their own profile and never used to hide anything.
 */

export type PreferencesStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Stable order for display and saving: as TEAM_INTERESTS lists them. */
const ordered = (teams: Iterable<string>) => {
  const set = new Set(teams)
  return TEAM_INTERESTS.map(t => t.key).filter(k => set.has(k))
}

export function createPreferences(client: SupabaseClient | null, auth: AuthStore | null) {
  const status = ref<PreferencesStatus>('idle')
  const teams = ref<TeamInterest[]>([])
  const saving = ref(false)
  const error = ref<string | null>(null)
  let request = 0

  async function load() {
    const uid = auth?.userId.value
    if (!client || !uid) return
    const mine = ++request
    status.value = 'loading'
    try {
      const { data, error: e } = await client.from('profile_preferences').select('teams').eq('profile_id', uid).maybeSingle()
      if (mine !== request) return
      if (e) throw e
      teams.value = ordered(((data as { teams?: string[] } | null)?.teams ?? []).filter(isTeamInterest))
      status.value = 'ready'
    }
    catch {
      if (mine === request) status.value = 'error'
    }
  }

  /** Follow or unfollow one team. Shown as chosen only once Supabase has saved it. */
  async function toggle(key: TeamInterest): Promise<boolean> {
    if (!client || !auth?.userId.value || saving.value || status.value !== 'ready') return false
    const next = teams.value.includes(key) ? teams.value.filter(t => t !== key) : ordered([...teams.value, key])
    saving.value = true
    error.value = null
    try {
      const { data, error: e } = await client.rpc('save_team_interests', { p_teams: next }).single()
      if (e) throw e
      teams.value = ordered(((data as { teams?: string[] } | null)?.teams ?? []).filter(isTeamInterest))
      return true
    }
    catch {
      error.value = 'Det gick inte att spara. Försök igen.'
      return false
    }
    finally {
      saving.value = false
    }
  }

  // Preferences belong to whoever is signed in: forget them when that changes.
  if (auth) {
    watch(auth.userId, () => {
      request++
      teams.value = []
      error.value = null
      status.value = 'idle'
    })
  }

  return { status, teams, saving, error, load, toggle }
}

export type PreferencesStore = ReturnType<typeof createPreferences>
