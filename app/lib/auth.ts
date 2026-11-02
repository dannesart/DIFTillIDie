import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { ref } from 'vue'
import type { SupporterProfile } from '#shared/utils/profile'
import { normalizeHandle, validateDisplayName, validateHandle } from '#shared/utils/profile'

/*
 * Supporter accounts: a six-digit code by e-mail (Supabase signInWithOtp /
 * verifyOtp), plus the supporter's own profile. The supporter never leaves the
 * page — no redirects — so it behaves the same in Safari, other browsers and
 * the installed home-screen app. Framework-free so it can be unit-tested with
 * a fake client; the Nuxt plugin creates one instance in the browser.
 *
 * Signing in only proves who someone is. It grants nothing else: permission to
 * join or post will be a separate, database-enforced decision (see
 * docs/authentication.md, "Registration modes").
 *
 * Privacy: our state holds the user's id and, while a code is pending, the
 * e-mail address they typed (on their own device). The address is never shown
 * to anyone else or stored in the profile.
 */

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'unavailable'
export type ProfileStatus = 'idle' | 'loading' | 'missing' | 'ready' | 'error'

/** Where supabase-js keeps the session (localStorage). */
export const AUTH_STORAGE_KEY = 'djurgarn-auth'
/** A code that's on its way: survives the app being reloaded while the supporter checks Mail. */
export const PENDING_KEY = 'djurgarn:otp-pending'
/** Matches Supabase's default email OTP length. */
export const CODE_LENGTH = 6
/** Supabase allows one code e-mail per address per 60 s by default. */
export const RESEND_COOLDOWN_S = 60
/** Forget a pending code after this long (Supabase's default expiry is 1 h). */
const PENDING_TTL_MS = 60 * 60 * 1000

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AuthOptions {
  storage?: KeyValueStorage
  /** What to report before init() (and on the server): must match on both sides. */
  initialStatus?: AuthStatus
  /**
   * May signing in create a new account? false = closed registration: existing
   * supporters still sign in, new e-mail addresses are refused.
   */
  allowNewAccounts?: boolean
  now?: () => number
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export function validateEmail(email: string): string | null {
  if (!email) return 'Skriv din e-postadress.'
  if (email.length > 254 || !EMAIL.test(email)) return 'Det ser inte ut som en e-postadress.'
  return null
}

/** Keep only digits; accept a pasted "123 456" or "123-456". */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

const NETWORK = 'Ingen kontakt med servern. Kolla uppkopplingen och försök igen.'

function isNetworkError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e)
  return e instanceof TypeError || /failed to fetch|network|load failed|fetch failed/i.test(msg)
}

interface AuthLikeError { message?: string, code?: string, status?: number }

/** Seconds Supabase asks us to wait ("…only request this after 42 seconds"), if it said. */
export function retryAfterSeconds(e: AuthLikeError | undefined): number | null {
  const m = e?.message?.match(/after (\d+) seconds?/i)
  return m ? Number(m[1]) : null
}

/** Human, Swedish messages for problems sending a code. */
export function sendErrorMessage(e: AuthLikeError | undefined): string {
  const raw = `${e?.code ?? ''} ${e?.message ?? ''}`
  if (isNetworkError(e)) return NETWORK
  if (/over_email_send_rate_limit|only request this after|email rate limit/i.test(raw)) return 'Vänta lite innan du ber om en ny kod.'
  if (/over_request_rate_limit|too many requests/i.test(raw) || e?.status === 429) return 'För många försök just nu. Vänta en stund och försök igen.'
  if (/signups? not allowed|signup_disabled|otp_disabled|user not found/i.test(raw)) return 'Nya konton kan inte skapas just nu. Har du redan ett konto? Kolla att adressen stämmer.'
  if (/email_address_invalid|invalid.*email|unable to validate email/i.test(raw)) return 'Den e-postadressen fungerar inte. Kolla stavningen.'
  if (/email_provider_disabled|email logins are disabled/i.test(raw)) return 'Inloggning med e-post är inte påslagen än.'
  return 'Koden kunde inte skickas. Försök igen om en stund.'
}

/** Human, Swedish messages for problems with the code itself. */
export function verifyErrorMessage(e: AuthLikeError | undefined): string {
  const raw = `${e?.code ?? ''} ${e?.message ?? ''}`
  if (isNetworkError(e)) return NETWORK
  if (/otp_expired|expired|invalid/i.test(raw)) return 'Koden stämmer inte eller har gått ut. Kolla siffrorna eller be om en ny kod.'
  if (/over_request_rate_limit|too many/i.test(raw) || e?.status === 429) return 'För många försök. Vänta en stund innan du försöker igen.'
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

interface Pending { email: string, sentAt: number }

export function createAuth(client: SupabaseClient | null, options: AuthOptions = {}) {
  const storage = options.storage ?? globalThis.localStorage
  const now = options.now ?? Date.now
  const allowNewAccounts = options.allowNewAccounts ?? true

  const status = ref<AuthStatus>(options.initialStatus ?? (client ? 'loading' : 'unavailable'))
  const userId = ref<string | null>(null)
  const profile = ref<SupporterProfile | null>(null)
  const profileStatus = ref<ProfileStatus>('idle')
  /** The address a code was sent to, while waiting for it. */
  const pendingEmail = ref<string | null>(null)
  /** When the last code was sent (ms), for the resend cooldown. */
  const sentAt = ref<number | null>(null)
  /** Extra wait the server asked for, on top of our own cooldown. */
  const serverWaitUntil = ref<number | null>(null)
  let profileRequest = 0
  let loading: Promise<void> | null = null

  function readPending() {
    try {
      const raw = storage.getItem(PENDING_KEY)
      if (!raw) return
      const p = JSON.parse(raw) as Pending
      if (typeof p.email === 'string' && typeof p.sentAt === 'number' && now() - p.sentAt < PENDING_TTL_MS) {
        pendingEmail.value = p.email
        sentAt.value = p.sentAt
      }
      else storage.removeItem(PENDING_KEY)
    }
    catch { /* unreadable: start over */ }
  }

  function writePending(p: Pending | null) {
    pendingEmail.value = p?.email ?? null
    sentAt.value = p?.sentAt ?? null
    try {
      if (p) storage.setItem(PENDING_KEY, JSON.stringify(p))
      else storage.removeItem(PENDING_KEY)
    }
    catch { /* storage blocked: the code still works in this session */ }
  }

  /** Seconds left before another code may be requested (0 = now). */
  function resendIn(at = now()): number {
    const ours = sentAt.value ? sentAt.value + RESEND_COOLDOWN_S * 1000 : 0
    const until = Math.max(ours, serverWaitUntil.value ?? 0)
    return Math.max(0, Math.ceil((until - at) / 1000))
  }

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
    readPending()
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

  /** Step 1: e-mail a six-digit code. */
  async function requestCode(input: string): Promise<{ ok: true } | { ok: false, message: string, field?: 'email' }> {
    if (!client) return { ok: false, message: 'Inloggning är inte påslagen här.' }
    const email = normalizeEmail(input)
    const invalid = validateEmail(email)
    if (invalid) return { ok: false, message: invalid, field: 'email' }
    // Same address again: respect the cooldown. A different address starts fresh.
    if (email === pendingEmail.value && resendIn() > 0) return { ok: false, message: 'Vänta lite innan du ber om en ny kod.' }
    try {
      const { error: e } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: allowNewAccounts } })
      if (e) throw e
      serverWaitUntil.value = null
      writePending({ email, sentAt: now() })
      return { ok: true }
    }
    catch (e) {
      const wait = retryAfterSeconds(e as AuthLikeError)
      if (wait) serverWaitUntil.value = now() + wait * 1000
      const message = sendErrorMessage(e as AuthLikeError)
      return { ok: false, message, field: /e-postadress/.test(message) && !/Vänta/.test(message) ? 'email' : undefined }
    }
  }

  /** Step 2: check the code. On success supabase-js stores the session. */
  async function verifyCode(input: string): Promise<{ ok: true, needsProfile: boolean } | { ok: false, message: string }> {
    if (!client) return { ok: false, message: 'Inloggning är inte påslagen här.' }
    const email = pendingEmail.value
    if (!email) return { ok: false, message: 'Be om en kod först.' }
    const token = normalizeCode(input)
    if (token.length !== CODE_LENGTH) return { ok: false, message: `Koden har ${CODE_LENGTH} siffror.` }
    try {
      const { data, error: e } = await client.auth.verifyOtp({ email, token, type: 'email' })
      if (e) throw e
      writePending(null)
      applySession(data.session)
      await loadProfile()
      return { ok: true, needsProfile: profileStatus.value === 'missing' }
    }
    catch (e) {
      return { ok: false, message: verifyErrorMessage(e as AuthLikeError) }
    }
  }

  /** Back to step 1 (wrong address, or start over). */
  function cancelCode() {
    writePending(null)
    serverWaitUntil.value = null
  }

  /** Sign out on this device. Always ends signed out locally, even offline. */
  async function signOut() {
    if (!client) return
    try {
      const { error: e } = await client.auth.signOut({ scope: 'local' })
      if (e) throw e
    }
    catch {
      try { storage.removeItem(AUTH_STORAGE_KEY) }
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

  return {
    status, userId, profile, profileStatus, pendingEmail, sentAt,
    init, loadProfile, requestCode, verifyCode, cancelCode, resendIn, signOut, saveProfile,
    whenProfileLoaded: () => loading ?? Promise.resolve(),
  }
}

export type AuthStore = ReturnType<typeof createAuth>
