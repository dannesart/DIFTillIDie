import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AUTH_STORAGE_KEY, PENDING_KEY, PROFILE_DESIGN_UNAVAILABLE, RESEND_COOLDOWN_S, createAuth, normalizeCode, normalizeEmail, profileErrorMessage,
  retryAfterSeconds, sendErrorMessage, validateEmail, verifyErrorMessage,
} from '../app/lib/auth'
import { accountEntry } from '../app/lib/accountEntry'
import { sectionLinks } from '../app/lib/sectionLinks'
import { normalizeHandle, validateDisplayName, validateHandle } from '../shared/utils/profile'

/* A fake Supabase client: just the calls the auth store makes, all recorded. */
function fakeClient(opts: {
  session?: unknown
  getSessionError?: unknown
  otpError?: unknown | (() => unknown)
  verify?: { session?: unknown, error?: unknown }
  signOutError?: unknown
  signOutThrows?: unknown
  profile?: unknown
  profileError?: unknown
  save?: { data?: unknown, error?: unknown } | (() => { data?: unknown, error?: unknown })
} = {}) {
  const calls: { method: string, args: unknown[] }[] = []
  let listener: ((event: string, session: unknown) => void) | undefined
  const rec = (method: string, ...args: unknown[]) => calls.push({ method, args })
  const client = {
    auth: {
      onAuthStateChange: (cb: typeof listener) => { listener = cb; return { data: { subscription: { unsubscribe() {} } } } },
      getSession: async () => (rec('getSession'), { data: { session: opts.session ?? null }, error: opts.getSessionError ?? null }),
      signInWithOtp: async (a: unknown) => {
        rec('signInWithOtp', a)
        const error = typeof opts.otpError === 'function' ? (opts.otpError as () => unknown)() : opts.otpError
        return { data: {}, error: error ?? null }
      },
      verifyOtp: async (a: unknown) => (rec('verifyOtp', a), { data: { session: opts.verify?.session ?? null }, error: opts.verify?.error ?? null }),
      signOut: async (a: unknown) => {
        rec('signOut', a)
        if (opts.signOutThrows) throw opts.signOutThrows
        return { error: opts.signOutError ?? null }
      },
    },
    from: (table: string) => {
      rec('from', table)
      let isWrite = false
      const saved = () => (typeof opts.save === 'function' ? opts.save() : opts.save)
      const result = () => {
        if (!isWrite) return { data: opts.profile ?? null, error: opts.profileError ?? null }
        const s = saved() // once per request
        return { data: s?.data ?? null, error: s?.error ?? null }
      }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) q[m] = (...a: unknown[]) => (rec(`db.${m}`, ...a), q)
      q.insert = (...a: unknown[]) => (isWrite = true, rec('db.insert', ...a), q)
      q.update = (...a: unknown[]) => (isWrite = true, rec('db.update', ...a), q)
      q.maybeSingle = async () => (rec('db.maybeSingle'), result())
      q.single = async () => (rec('db.single'), result())
      return q
    },
  }
  return { client: client as unknown as SupabaseClient, calls, emit: (event: string, session: unknown) => listener?.(event, session) }
}

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), map: m }
}

const session = (id = 'user-lotta') => ({
  access_token: 't',
  user: { id, email: 'lotta.private@example.test', user_metadata: { full_name: 'Lotta Privat Efternamn' } },
})
const row = { id: 'user-lotta', display_name: 'Lotta från Gärdet', handle: 'kaminen81' }
const tick = () => new Promise(r => setTimeout(r, 5))

/** A clock we can move. */
function clock(start = 1_800_000_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('state', () => {
  it('is unavailable without a client (missing configuration)', () => {
    expect(createAuth(null).status.value).toBe('unavailable')
  })

  it('starts "loading", then signed-out without a stored session', async () => {
    const auth = createAuth(fakeClient().client, { storage: memoryStorage() })
    expect(auth.status.value).toBe('loading')
    await auth.init()
    expect(auth.status.value).toBe('signed-out')
  })

  it('restores a stored session on start-up (e.g. reopening the installed app) and loads the profile', async () => {
    const { client, calls } = fakeClient({ session: session(), profile: row })
    const auth = createAuth(client, { storage: memoryStorage() })
    await auth.init()
    expect(auth.status.value).toBe('signed-in')
    expect(calls.some(c => c.method === 'signInWithOtp' || c.method === 'verifyOtp')).toBe(false)
    await tick(); await auth.whenProfileLoaded()
    expect(auth.profileStatus.value).toBe('ready')
    expect(auth.profile.value).toEqual({ id: 'user-lotta', displayName: 'Lotta från Gärdet', handle: 'kaminen81', bio: null, avatar: null })
  })

  it('reports a missing profile for a new supporter', async () => {
    const auth = createAuth(fakeClient({ session: session(), profile: null }).client, { storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    expect(auth.profileStatus.value).toBe('missing')
  })

  it('reports a profile load failure without signing out', async () => {
    const auth = createAuth(fakeClient({ session: session(), profileError: new TypeError('Failed to fetch') }).client, { storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    expect(auth.status.value).toBe('signed-in')
    expect(auth.profileStatus.value).toBe('error')
  })

  it('treats a failed restore (e.g. offline, expired token) as signed out', async () => {
    const auth = createAuth(fakeClient({ getSessionError: new TypeError('Failed to fetch') }).client, { storage: memoryStorage() })
    await auth.init()
    expect(auth.status.value).toBe('signed-out')
  })

  it('follows auth events, clearing the profile on sign-out elsewhere', async () => {
    const { client, emit } = fakeClient({ session: session(), profile: row })
    const auth = createAuth(client, { storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    emit('SIGNED_OUT', null)
    expect(auth.status.value).toBe('signed-out')
    expect(auth.profile.value).toBeNull()
  })

  it('never exposes the account’s e-mail or identity metadata', async () => {
    const auth = createAuth(fakeClient({ session: session(), profile: null }).client, { storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    const exposed = JSON.stringify({ s: auth.status.value, u: auth.userId.value, p: auth.profile.value, ps: auth.profileStatus.value, e: auth.pendingEmail.value })
    expect(exposed).not.toMatch(/private@example|Efternamn/)
  })
})

describe('step 1: requesting a code', () => {
  it('sends a code to the normalised address and remembers it was sent', async () => {
    const c = clock()
    const storage = memoryStorage()
    const { client, calls } = fakeClient()
    const auth = createAuth(client, { storage, now: c.now })
    await auth.init()
    expect(await auth.requestCode('  Lotta@Example.SE ')).toEqual({ ok: true })
    expect(calls.find(x => x.method === 'signInWithOtp')!.args).toEqual([{ email: 'lotta@example.se', options: { shouldCreateUser: true } }])
    expect(auth.pendingEmail.value).toBe('lotta@example.se')
    expect(JSON.parse(storage.map.get(PENDING_KEY)!)).toEqual({ email: 'lotta@example.se', sentAt: c.now() })
  })

  it('rejects an invalid address before any request', async () => {
    const { client, calls } = fakeClient()
    const auth = createAuth(client, { storage: memoryStorage() })
    await auth.init()
    expect(await auth.requestCode('lotta@')).toEqual({ ok: false, message: 'Det ser inte ut som en e-postadress.', field: 'email' })
    expect(await auth.requestCode('   ')).toMatchObject({ ok: false, field: 'email' })
    expect(calls.some(x => x.method === 'signInWithOtp')).toBe(false)
  })

  it('enforces a resend cooldown for the same address, and lifts it after 60 s', async () => {
    const c = clock()
    const { client, calls } = fakeClient()
    const auth = createAuth(client, { storage: memoryStorage(), now: c.now })
    await auth.init()
    await auth.requestCode('lotta@example.se')
    expect(auth.resendIn()).toBe(RESEND_COOLDOWN_S)
    expect(await auth.requestCode('lotta@example.se')).toEqual({ ok: false, message: 'Vänta lite innan du ber om en ny kod.' })
    c.advance(59_000)
    expect(auth.resendIn()).toBe(1)
    c.advance(1_000)
    expect(auth.resendIn()).toBe(0)
    expect(await auth.requestCode('lotta@example.se')).toEqual({ ok: true })
    expect(calls.filter(x => x.method === 'signInWithOtp')).toHaveLength(2)
  })

  it('adopts the wait time Supabase asks for when rate-limited', async () => {
    const c = clock()
    const auth = createAuth(fakeClient({ otpError: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' } }).client, { storage: memoryStorage(), now: c.now })
    await auth.init()
    expect(await auth.requestCode('lotta@example.se')).toMatchObject({ ok: false, message: 'Vänta lite innan du ber om en ny kod.' })
    expect(auth.resendIn()).toBe(42)
  })

  it('explains when new accounts can’t be created (closed registration)', async () => {
    const auth = createAuth(fakeClient({ otpError: { status: 422, code: 'otp_disabled', message: 'Signups not allowed for otp' } }).client, { storage: memoryStorage() })
    await auth.init()
    expect(await auth.requestCode('ny@example.se')).toMatchObject({ ok: false, message: expect.stringMatching(/Nya konton kan inte skapas/) })
  })

  it('can keep existing supporters signing in while refusing new accounts', async () => {
    const { client, calls } = fakeClient()
    const auth = createAuth(client, { storage: memoryStorage(), allowNewAccounts: false })
    await auth.init()
    await auth.requestCode('lotta@example.se')
    expect(calls.find(x => x.method === 'signInWithOtp')!.args).toEqual([{ email: 'lotta@example.se', options: { shouldCreateUser: false } }])
  })

  it('handles network failure', async () => {
    const auth = createAuth(fakeClient({ otpError: new TypeError('Failed to fetch') }).client, { storage: memoryStorage() })
    await auth.init()
    expect(await auth.requestCode('lotta@example.se')).toMatchObject({ ok: false, message: expect.stringMatching(/Ingen kontakt/) })
    expect(auth.pendingEmail.value).toBeNull()
  })
})

describe('step 2: verifying the code', () => {
  async function codeSent(o: Parameters<typeof fakeClient>[0] = {}) {
    const f = fakeClient(o)
    const auth = createAuth(f.client, { storage: memoryStorage() })
    await auth.init()
    await auth.requestCode('lotta@example.se')
    return { auth, calls: f.calls }
  }

  it('verifies the code for the pending address and signs in', async () => {
    const { auth, calls } = await codeSent({ verify: { session: session() }, profile: null })
    expect(await auth.verifyCode('123 456')).toEqual({ ok: true, needsProfile: true })
    expect(calls.find(x => x.method === 'verifyOtp')!.args).toEqual([{ email: 'lotta@example.se', token: '123456', type: 'email' }])
    expect(auth.status.value).toBe('signed-in')
    expect(auth.pendingEmail.value).toBeNull()
  })

  it('knows a returning supporter already has a profile', async () => {
    const { auth } = await codeSent({ verify: { session: session() }, profile: row })
    expect(await auth.verifyCode('123456')).toEqual({ ok: true, needsProfile: false })
  })

  it('rejects incomplete codes before any request', async () => {
    const { auth, calls } = await codeSent()
    expect(await auth.verifyCode('12345')).toEqual({ ok: false, message: 'Koden har 6 siffror.' })
    expect(calls.some(x => x.method === 'verifyOtp')).toBe(false)
  })

  it('explains a wrong or expired code and stays on the code step', async () => {
    const { auth } = await codeSent({ verify: { error: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' } } })
    expect(await auth.verifyCode('000000')).toEqual({ ok: false, message: expect.stringMatching(/stämmer inte eller har gått ut/) })
    expect(auth.status.value).toBe('signed-out')
    expect(auth.pendingEmail.value).toBe('lotta@example.se')
  })

  it('handles too many attempts and network failure', async () => {
    expect(verifyErrorMessage({ status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' })).toMatch(/För många försök/)
    const { auth } = await codeSent({ verify: { error: new TypeError('Failed to fetch') } })
    expect(await auth.verifyCode('123456')).toEqual({ ok: false, message: expect.stringMatching(/Ingen kontakt/) })
  })

  it('needs a code to have been requested first', async () => {
    const auth = createAuth(fakeClient().client, { storage: memoryStorage() })
    await auth.init()
    expect(await auth.verifyCode('123456')).toEqual({ ok: false, message: 'Be om en kod först.' })
  })

  it('survives the app being reloaded while the supporter checks Mail', async () => {
    const storage = memoryStorage()
    const c = clock()
    const first = createAuth(fakeClient().client, { storage, now: c.now })
    await first.init()
    await first.requestCode('lotta@example.se')
    c.advance(20_000)
    const { client, calls } = fakeClient({ verify: { session: session() } })
    const second = createAuth(client, { storage, now: c.now })
    await second.init()
    expect(second.pendingEmail.value).toBe('lotta@example.se')
    expect(second.resendIn()).toBe(40)
    expect((await second.verifyCode('123456')).ok).toBe(true)
    expect(calls.find(x => x.method === 'verifyOtp')!.args[0]).toMatchObject({ email: 'lotta@example.se' })
  })

  it('forgets a pending code after an hour', async () => {
    const storage = memoryStorage()
    storage.setItem(PENDING_KEY, JSON.stringify({ email: 'lotta@example.se', sentAt: 1_000 }))
    const auth = createAuth(fakeClient().client, { storage, now: () => 1_000 + 61 * 60_000 })
    await auth.init()
    expect(auth.pendingEmail.value).toBeNull()
    expect(storage.map.has(PENDING_KEY)).toBe(false)
  })

  it('can go back to change the address', async () => {
    const { auth } = await codeSent()
    auth.cancelCode()
    expect(auth.pendingEmail.value).toBeNull()
    expect(auth.resendIn()).toBe(0)
  })
})

describe('signing out', () => {
  it('signs out this device and forgets the profile', async () => {
    const { client, calls } = fakeClient({ session: session(), profile: row })
    const auth = createAuth(client, { storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    await auth.signOut()
    expect(calls.find(c => c.method === 'signOut')!.args).toEqual([{ scope: 'local' }])
    expect(auth.status.value).toBe('signed-out')
    expect(auth.profile.value).toBeNull()
  })

  it("takes \"you\" in the navigation from your läktarplats back to the sign-in dialog", async () => {
    const auth = createAuth(fakeClient({ session: session(), profile: row }).client, { storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    const entry = () => accountEntry(auth.status.value, auth.profileStatus.value, auth.profile.value?.handle, sectionLinks('/').supporter)
    expect(entry()).toEqual({ kind: 'profile', to: '/laktaren/kaminen81' })
    await auth.signOut()
    expect(entry()).toEqual({ kind: 'dialog' })
  })

  it('still ends signed out locally when the network is down', async () => {
    const storage = memoryStorage()
    storage.setItem(AUTH_STORAGE_KEY, '{"access_token":"t"}')
    const auth = createAuth(fakeClient({ session: session(), signOutThrows: new TypeError('Failed to fetch') }).client, { storage })
    await auth.init()
    await auth.signOut()
    expect(auth.status.value).toBe('signed-out')
    expect(storage.map.has(AUTH_STORAGE_KEY)).toBe(false)
  })
})

describe('saving the profile', () => {
  async function signedIn(o: Parameters<typeof fakeClient>[0]) {
    const f = fakeClient({ session: session(), ...o })
    const auth = createAuth(f.client, { storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    return { auth, calls: f.calls }
  }

  it('creates the profile for a new supporter, with only the chosen fields', async () => {
    const { auth, calls } = await signedIn({ profile: null, save: { data: row } })
    expect(await auth.saveProfile({ displayName: '  Lotta från Gärdet ', handle: '@Kaminen81' })).toEqual({ ok: true })
    expect(calls.find(c => c.method === 'db.insert')!.args).toEqual([{ id: 'user-lotta', display_name: 'Lotta från Gärdet', handle: 'kaminen81' }])
    expect(auth.profileStatus.value).toBe('ready')
  })

  it('updates an existing profile instead of inserting', async () => {
    const { auth, calls } = await signedIn({ profile: row, save: { data: { ...row, display_name: 'Lotta' } } })
    await auth.saveProfile({ displayName: 'Lotta', handle: 'kaminen81' })
    expect(calls.some(c => c.method === 'db.insert')).toBe(false)
    expect(calls.find(c => c.method === 'db.update')!.args).toEqual([{ display_name: 'Lotta', handle: 'kaminen81' }])
    expect(auth.profile.value?.displayName).toBe('Lotta')
  })

  it('rejects invalid input before any request', async () => {
    const { auth, calls } = await signedIn({ profile: null })
    const before = calls.length
    expect(await auth.saveProfile({ displayName: 'L', handle: 'dif' })).toEqual({ ok: false, errors: { displayName: expect.any(String), handle: 'Det namnet är reserverat.' } })
    expect(calls.length).toBe(before)
  })

  it('maps a taken handle to the handle field', async () => {
    const { auth } = await signedIn({ profile: null, save: { error: { code: '23505', message: 'duplicate key value violates unique constraint "profiles_handle_unique"' } } })
    expect(await auth.saveProfile({ displayName: 'Lotta', handle: 'hovethasse' })).toEqual({ ok: false, errors: { handle: 'Upptaget – välj ett annat.' } })
  })

  it('handles network failure and refused writes', async () => {
    expect(profileErrorMessage(new TypeError('Failed to fetch')).form).toMatch(/Ingen kontakt/)
    expect(profileErrorMessage({ code: '42501' }).form).toMatch(/egen profil/)
    const { auth } = await signedIn({ profile: null, save: { error: new TypeError('Failed to fetch') } })
    expect((await auth.saveProfile({ displayName: 'Lotta', handle: 'lotta' })) as unknown).toEqual({ ok: false, errors: { form: expect.stringMatching(/Ingen kontakt/) } })
  })

  it('saves a bio (one tidy paragraph) and an avatar design; empty clears the bio', async () => {
    const saved = { ...row, bio: 'Sektion A sedan -98.', avatar: 'halsduk' }
    const { auth, calls } = await signedIn({ profile: row, save: { data: saved } })
    expect(await auth.saveProfile({ displayName: 'Lotta från Gärdet', handle: 'kaminen81', bio: '  Sektion A\n sedan -98. ', avatar: 'halsduk' })).toEqual({ ok: true })
    expect(calls.find(c => c.method === 'db.update')!.args).toEqual([{ display_name: 'Lotta från Gärdet', handle: 'kaminen81', bio: 'Sektion A sedan -98.', avatar: 'halsduk' }])
    expect(auth.profile.value).toEqual({ id: 'user-lotta', displayName: 'Lotta från Gärdet', handle: 'kaminen81', bio: 'Sektion A sedan -98.', avatar: 'halsduk' })
    await auth.saveProfile({ displayName: 'Lotta från Gärdet', handle: 'kaminen81', bio: '   ', avatar: null })
    expect(calls.filter(c => c.method === 'db.update').at(-1)!.args).toEqual([{ display_name: 'Lotta från Gärdet', handle: 'kaminen81', bio: null, avatar: null }])
  })

  it('only what changed is sent: an unchanged bio and avatar are left out', async () => {
    const current = { ...row, bio: 'Sektion A.', avatar: 'halsduk' }
    const { auth, calls } = await signedIn({ profile: current, save: { data: { ...current, display_name: 'Lotta G' } } })
    await auth.saveProfile({ displayName: 'Lotta G', handle: 'kaminen81', bio: 'Sektion A.', avatar: 'halsduk' })
    expect(calls.find(c => c.method === 'db.update')!.args).toEqual([{ display_name: 'Lotta G', handle: 'kaminen81' }])
  })

  describe('a database without bio and avatar yet (before the supporter-profiles migration)', () => {
    const before = (code: string) => { let n = 0; return () => (n++ ? { data: row } : { error: { code, message: 'column does not exist' } }) }

    it('a new bio or avatar: says plainly it can’t be saved here yet, nothing saved, no retry', async () => {
      for (const [code, change] of [['42703', { bio: 'Sektion A.' }], ['PGRST204', { avatar: 'stjarna' as const }]] as const) {
        const { auth, calls } = await signedIn({ profile: row, save: before(code) })
        const r = await auth.saveProfile({ displayName: 'Lotta från Gärdet', handle: 'kaminen81', ...change })
        expect(r).toEqual({ ok: false, errors: { form: PROFILE_DESIGN_UNAVAILABLE } })
        expect(PROFILE_DESIGN_UNAVAILABLE).toMatch(/Inget har sparats/)
        expect(calls.filter(c => c.method === 'db.update')).toHaveLength(1)
        // Not pretended: the profile is as it was.
        expect(auth.profile.value).toEqual({ id: 'user-lotta', displayName: 'Lotta från Gärdet', handle: 'kaminen81', bio: null, avatar: null })
      }
    })

    it('a name or handle change alone still saves, reading back the columns it has', async () => {
      const { auth, calls } = await signedIn({ profile: row, save: before('42703') })
      expect(await auth.saveProfile({ displayName: 'Lotta från Gärdet', handle: 'kaminen81', bio: '', avatar: null })).toEqual({ ok: true })
      const selects = calls.filter(c => c.method === 'db.select').map(c => String(c.args[0])).slice(-2)
      expect(selects).toEqual(['id, display_name, handle, bio, avatar', 'id, display_name, handle'])
      expect(calls.filter(c => c.method === 'db.update').map(c => c.args[0])).toEqual([{ display_name: 'Lotta från Gärdet', handle: 'kaminen81' }, { display_name: 'Lotta från Gärdet', handle: 'kaminen81' }])
    })
  })

  it('a bio that is too long is caught before any request', async () => {
    const { auth, calls } = await signedIn({ profile: row })
    const before = calls.length
    expect(await auth.saveProfile({ displayName: 'Lotta', handle: 'lotta', bio: 'x'.repeat(161) })).toEqual({ ok: false, errors: { bio: 'Högst 160 tecken.' } })
    expect(calls.length).toBe(before)
  })

  it('reads its profile from a database without bio and avatar yet (before that migration)', async () => {
    let n = 0
    const { client } = fakeClient({ session: session() })
    const real = client.from.bind(client)
    ;(client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as unknown as Record<string, unknown>
      q.maybeSingle = async () => (n++ ? { data: row, error: null } : { data: null, error: { code: '42703', message: 'column profiles.bio does not exist' } })
      return q
    }
    const auth = createAuth(client, { storage: memoryStorage() })
    await auth.init()
    await tick()
    await auth.whenProfileLoaded()
    expect([auth.profileStatus.value, auth.profile.value]).toEqual(['ready', { id: 'user-lotta', displayName: 'Lotta från Gärdet', handle: 'kaminen81', bio: null, avatar: null }])
  })

  it('refuses to save when signed out', async () => {
    const auth = createAuth(fakeClient().client, { storage: memoryStorage() })
    await auth.init()
    expect(await auth.saveProfile({ displayName: 'Lotta', handle: 'lotta' })).toEqual({ ok: false, errors: { form: 'Logga in först.' } })
  })
})

describe('helpers', () => {
  it('e-mail: normalise and validate', () => {
    expect(normalizeEmail('  Lotta@Example.SE ')).toBe('lotta@example.se')
    expect(validateEmail('lotta@example.se')).toBeNull()
    for (const bad of ['', 'lotta', 'lotta@', '@example.se', 'lotta@example', 'lo tta@example.se']) expect(validateEmail(bad), bad).not.toBeNull()
  })

  it('code: digits only, at most six', () => {
    expect(normalizeCode('123 456')).toBe('123456')
    expect(normalizeCode('12-34-56-78')).toBe('123456')
    expect(normalizeCode('abc')).toBe('')
  })

  it('reads Supabase’s retry hint', () => {
    expect(retryAfterSeconds({ message: 'For security purposes, you can only request this after 7 seconds.' })).toBe(7)
    expect(retryAfterSeconds({ message: 'nope' })).toBeNull()
  })

  it('send errors fall back to something calm', () => {
    expect(sendErrorMessage({ message: 'Email address "x" is invalid', code: 'email_address_invalid' })).toMatch(/fungerar inte/)
    expect(sendErrorMessage({ message: 'something odd' })).toMatch(/kunde inte skickas/)
  })

  it('profile rules: normalize, validate', () => {
    expect(normalizeHandle('@Lotta från Gärdet!')).toBe('lotta_fran_gardet')
    expect(normalizeHandle('  Hovet-Hasse ')).toBe('hovet_hasse')
    expect(validateHandle('ok')).toMatch(/Minst 3/)
    expect(validateHandle('kaminen81')).toBeNull()
    expect(validateDisplayName(' Lotta ')).toBeNull()
    expect(validateDisplayName('x'.repeat(41))).toMatch(/Högst 40/)
  })
})
