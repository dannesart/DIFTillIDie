import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { ref } from 'vue'
import type { SupporterProfile } from '#shared/utils/profile'
import { normalizeHandle, validateDisplayName, validateHandle } from '#shared/utils/profile'

/*
 * Supporter accounts: Google sign-in through Supabase Auth (PKCE), plus the
 * supporter's own profile. Framework-free so it can be unit-tested with a fake
 * client; the Nuxt plugin creates one instance in the browser.
 *
 * Privacy: we only ever keep the user's id. Google's name, e-mail address and
 * picture are never read, stored in our state, or shown — the profile is what
 * the supporter chooses to be called here.
 */

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'unavailable'
export type ProfileStatus = 'idle' | 'loading' | 'missing' | 'ready' | 'error'

/** Where supabase-js keeps the session (localStorage). */
export const AUTH_STORAGE_KEY = 'djurgarn-auth'
/** Where to go after the round trip to Google. */
export const RETURN_KEY = 'djurgarn:auth-return'
export const CALLBACK_PATH = '/auth/callback'

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AuthOptions {
  /** e.g. https://djurgarn.netlify.app — the callback must be allow-listed in Supabase. */
  origin: string
  storage?: KeyValueStorage
  /** What to report before init() (and on the server): must match on both sides. */
  initialStatus?: AuthStatus
}

/** Only same-site paths ("/", "/#snacket"); anything else (//evil.com, https://…) becomes "/". */
export function safeReturnTo(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/'
  if (path.startsWith(CALLBACK_PATH)) return '/'
  return path
}

export function parseCallback(url: string): { code?: string, error?: string, description?: string } {
  const u = new URL(url)
  // Errors can come back in the query (PKCE) or the fragment (implicit / some providers).
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
  const get = (k: string) => u.searchParams.get(k) ?? hash.get(k) ?? undefined
  return { code: get('code'), error: get('error') ?? get('error_code'), description: get('error_description') }
}

const NETWORK = 'Ingen kontakt med servern. Kolla uppkopplingen och försök igen.'

function isNetworkError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e)
  return e instanceof TypeError || /fetch|network|failed to fetch|load failed/i.test(msg)
}

/** Human, Swedish messages for sign-in problems. */
export function authErrorMessage(e: { message?: string, code?: string, error?: string } | string | undefined): string {
  const raw = typeof e === 'string' ? e : `${e?.code ?? e?.error ?? ''} ${e?.message ?? ''}`
  if (/access_denied/i.test(raw)) return 'Inloggningen avbröts. Inget har ändrats – försök igen när du vill.'
  // Expired or already-used code: the flow state is gone on the server.
  if (/flow_state_not_found|flow_state_expired|no valid flow state|expired/i.test(raw)) return 'Inloggningslänken hann bli för gammal. Försök igen.'
  // The code verifier lives in this browser's storage; if the callback opens elsewhere it's missing.
  if (/code.?verifier|bad_code_verifier/i.test(raw)) {
    return 'Inloggningen avslutades i ett annat fönster än där den startade – det kan hända i hemskärmsappen på iPhone. Gå tillbaka och försök igen.'
  }
  if (/provider.*(disabled|not enabled)|unsupported provider/i.test(raw)) return 'Inloggning med Google är inte påslagen än.'
  if (isNetworkError(e)) return NETWORK
  return 'Inloggningen gick inte att slutföra. Försök igen.'
}

export interface ProfileErrors {
  handle?: string
  displayName?: string
  form?: string
}

/** Database / network errors from saving a profile → field messages. */
export function profileErrorMessage(e: { code?: string, message?: string } | unknown): ProfileErrors {
  const code = (e as { code?: string })?.code
  if (code === '23505') return { handle: 'Upptaget – välj ett annat.' }
  if (code === '23514') return { form: 'Något i profilen följer inte reglerna. Kolla namn och handle.' }
  if (code === '42501') return { form: 'Du kan bara ändra din egen profil. Logga in igen och försök på nytt.' }
  if (isNetworkError(e)) return { form: NETWORK }
  return { form: 'Profilen kunde inte sparas. Försök igen.' }
}

interface ProfileRow { id: string, display_name: string, handle: string }
const toProfile = (r: ProfileRow): SupporterProfile => ({ id: r.id, displayName: r.display_name, handle: r.handle })

export function createAuth(client: SupabaseClient | null, options: AuthOptions) {
  const storage = options.storage ?? globalThis.localStorage
  const status = ref<AuthStatus>(options.initialStatus ?? (client ? 'loading' : 'unavailable'))
  const userId = ref<string | null>(null)
  const profile = ref<SupporterProfile | null>(null)
  const profileStatus = ref<ProfileStatus>('idle')
  const error = ref<string | null>(null)
  let profileRequest = 0
  let loading: Promise<void> | null = null

  function applySession(session: Session | null) {
    const id = session?.user?.id ?? null
    status.value = id ? 'signed-in' : 'signed-out'
    if (id === userId.value) return
    userId.value = id
    profile.value = null
    profileStatus.value = 'idle'
    // Not awaited here: supabase-js asks that auth callbacks don't block on further calls.
    if (id) setTimeout(() => void loadProfile(), 0)
  }

  async function init() {
    if (!client) return
    client.auth.onAuthStateChange((_event, session) => applySession(session))
    try {
      const { data, error: e } = await client.auth.getSession()
      if (e) throw e
      applySession(data.session)
    }
    catch {
      // Couldn't restore (e.g. offline with an expired token): show signed out, keep browsing.
      applySession(null)
    }
  }

  function loadProfile(): Promise<void> {
    const id = userId.value
    if (!client || !id) return Promise.resolve()
    const request = ++profileRequest
    profileStatus.value = 'loading'
    loading = (async () => {
      try {
        const { data, error: e } = await client.from('profiles').select('id, display_name, handle').eq('id', id).maybeSingle()
        if (request !== profileRequest || id !== userId.value) return
        if (e) throw e
        profile.value = data ? toProfile(data as ProfileRow) : null
        profileStatus.value = data ? 'ready' : 'missing'
      }
      catch {
        if (request === profileRequest) profileStatus.value = 'error'
      }
    })()
    return loading
  }

  /** Off to Google. supabase-js navigates the page; nothing else happens on success. */
  async function signInWithGoogle(returnTo = '/') {
    if (!client) return false
    error.value = null
    try { storage.setItem(RETURN_KEY, safeReturnTo(returnTo)) }
    catch { /* storage blocked: we'll land on the home page */ }
    try {
      const { error: e } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${options.origin}${CALLBACK_PATH}`,
          // Let people pick the right Google account instead of silently reusing one.
          queryParams: { prompt: 'select_account' },
        },
      })
      if (e) throw e
      return true
    }
    catch (e) {
      error.value = authErrorMessage(e as { message?: string })
      return false
    }
  }

  /** On /auth/callback: finish the PKCE exchange. */
  async function handleCallback(url: string): Promise<{ ok: true, returnTo: string, needsProfile: boolean } | { ok: false, message: string }> {
    if (!client) return { ok: false, message: 'Inloggning är inte konfigurerad här.' }
    const params = parseCallback(url)
    if (params.error) return { ok: false, message: authErrorMessage(`${params.error} ${params.description ?? ''}`) }
    if (!params.code) {
      // Maybe supabase-js already finished, or someone opened the page directly.
      const { data } = await client.auth.getSession()
      if (data.session) applySession(data.session)
      else return { ok: false, message: 'Det finns ingen inloggning att slutföra här.' }
    }
    else {
      try {
        const { data, error: e } = await client.auth.exchangeCodeForSession(params.code)
        if (e) throw e
        applySession(data.session)
      }
      catch (e) {
        return { ok: false, message: authErrorMessage(e as { message?: string }) }
      }
    }
    await loadProfile()
    let returnTo = '/'
    try {
      returnTo = safeReturnTo(storage.getItem(RETURN_KEY))
      storage.removeItem(RETURN_KEY)
    }
    catch { /* storage blocked */ }
    return { ok: true, returnTo, needsProfile: profileStatus.value === 'missing' }
  }

  /** Sign out on this device. Always ends signed out locally, even offline. */
  async function signOut() {
    if (!client) return
    try {
      const { error: e } = await client.auth.signOut({ scope: 'local' })
      if (e) throw e
    }
    catch {
      try {
        storage.removeItem(AUTH_STORAGE_KEY)
        storage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`)
      }
      catch { /* nothing more we can do */ }
    }
    applySession(null)
  }

  /** Create or update the supporter's own profile. The database enforces ownership and rules. */
  async function saveProfile(input: { displayName: string, handle: string }): Promise<{ ok: true } | { ok: false, errors: ProfileErrors }> {
    const id = userId.value
    if (!client || !id) return { ok: false, errors: { form: 'Logga in först.' } }
    const displayName = input.displayName.trim()
    const handle = normalizeHandle(input.handle)
    const errors: ProfileErrors = {}
    const nameError = validateDisplayName(displayName)
    const handleError = validateHandle(handle)
    if (nameError) errors.displayName = nameError
    if (handleError) errors.handle = handleError
    if (nameError || handleError) return { ok: false, errors }
    try {
      const values = { display_name: displayName, handle }
      const query = profile.value
        ? client.from('profiles').update(values).eq('id', id)
        : client.from('profiles').insert({ id, ...values })
      const { data, error: e } = await query.select('id, display_name, handle').single()
      if (e) throw e
      profile.value = toProfile(data as ProfileRow)
      profileStatus.value = 'ready'
      return { ok: true }
    }
    catch (e) {
      return { ok: false, errors: profileErrorMessage(e) }
    }
  }

  return { status, userId, profile, profileStatus, error, init, loadProfile, signInWithGoogle, handleCallback, signOut, saveProfile, whenProfileLoaded: () => loading ?? Promise.resolve() }
}

export type AuthStore = ReturnType<typeof createAuth>
