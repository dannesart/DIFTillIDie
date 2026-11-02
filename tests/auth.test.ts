import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, RETURN_KEY, authErrorMessage, createAuth, parseCallback, profileErrorMessage, safeReturnTo } from '../app/lib/auth'
import { normalizeHandle, validateDisplayName, validateHandle } from '../shared/utils/profile'

/* A fake Supabase client: just the calls the auth store makes, all recorded. */
function fakeClient(opts: {
  session?: unknown
  getSessionError?: unknown
  oauthError?: unknown
  exchange?: { session?: unknown, error?: unknown }
  signOutError?: unknown
  signOutThrows?: unknown
  profile?: unknown
  profileError?: unknown
  save?: { data?: unknown, error?: unknown }
} = {}) {
  const calls: { method: string, args: unknown[] }[] = []
  let listener: ((event: string, session: unknown) => void) | undefined
  const rec = (method: string, ...args: unknown[]) => calls.push({ method, args })
  const query = (result: () => unknown) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'insert', 'update']) q[m] = (...a: unknown[]) => (rec(`db.${m}`, ...a), q)
    q.maybeSingle = async () => (rec('db.maybeSingle'), result())
    q.single = async () => (rec('db.single'), result())
    return q
  }
  const client = {
    auth: {
      onAuthStateChange: (cb: typeof listener) => { listener = cb; return { data: { subscription: { unsubscribe() {} } } } },
      getSession: async () => (rec('getSession'), { data: { session: opts.session ?? null }, error: opts.getSessionError ?? null }),
      signInWithOAuth: async (a: unknown) => (rec('signInWithOAuth', a), { data: {}, error: opts.oauthError ?? null }),
      exchangeCodeForSession: async (code: string) => (rec('exchangeCodeForSession', code), { data: { session: opts.exchange?.session ?? null }, error: opts.exchange?.error ?? null }),
      signOut: async (a: unknown) => {
        rec('signOut', a)
        if (opts.signOutThrows) throw opts.signOutThrows
        return { error: opts.signOutError ?? null }
      },
    },
    from: (table: string) => {
      rec('from', table)
      let isWrite = false
      const q = query(() => isWrite ? { data: opts.save?.data ?? null, error: opts.save?.error ?? null } : { data: opts.profile ?? null, error: opts.profileError ?? null })
      const insert = q.insert as (...a: unknown[]) => unknown
      const update = q.update as (...a: unknown[]) => unknown
      q.insert = (...a: unknown[]) => { isWrite = true; return insert(...a) }
      q.update = (...a: unknown[]) => { isWrite = true; return update(...a) }
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
  user: { id, email: 'lotta.private@gmail.example', user_metadata: { full_name: 'Lotta Privat Googlesson', avatar_url: 'https://lh3.googleusercontent.example/x.jpg' } },
})
const row = { id: 'user-lotta', display_name: 'Lotta från Gärdet', handle: 'kaminen81' }
const tick = () => new Promise(r => setTimeout(r, 5))

describe('state', () => {
  it('is unavailable without a client (missing configuration)', () => {
    expect(createAuth(null, { origin: 'https://x.test' }).status.value).toBe('unavailable')
  })

  it('starts "loading", then signed-out without a stored session', async () => {
    const { client } = fakeClient()
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    expect(auth.status.value).toBe('loading')
    await auth.init()
    expect(auth.status.value).toBe('signed-out')
  })

  it('restores a stored session on start-up (e.g. reopening the installed app) and loads the profile', async () => {
    const { client, calls } = fakeClient({ session: session(), profile: row })
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init()
    expect(auth.status.value).toBe('signed-in')
    expect(calls.some(c => c.method === 'signInWithOAuth')).toBe(false)
    await tick(); await auth.whenProfileLoaded()
    expect(auth.profileStatus.value).toBe('ready')
    expect(auth.profile.value).toEqual({ id: 'user-lotta', displayName: 'Lotta från Gärdet', handle: 'kaminen81' })
  })

  it('reports a missing profile for a new supporter', async () => {
    const { client } = fakeClient({ session: session(), profile: null })
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    expect(auth.profileStatus.value).toBe('missing')
  })

  it('reports a profile load failure without signing out', async () => {
    const { client } = fakeClient({ session: session(), profileError: new TypeError('Failed to fetch') })
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    expect(auth.status.value).toBe('signed-in')
    expect(auth.profileStatus.value).toBe('error')
  })

  it('treats a failed restore (e.g. offline, expired token) as signed out', async () => {
    const { client } = fakeClient({ getSessionError: new TypeError('Failed to fetch') })
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init()
    expect(auth.status.value).toBe('signed-out')
  })

  it('follows auth events, clearing the profile on sign-out elsewhere', async () => {
    const { client, emit } = fakeClient({ session: session(), profile: row })
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    emit('SIGNED_OUT', null)
    expect(auth.status.value).toBe('signed-out')
    expect(auth.profile.value).toBeNull()
  })

  it('never exposes Google’s name, e-mail or picture', async () => {
    const { client } = fakeClient({ session: session(), profile: null })
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    const exposed = JSON.stringify({ s: auth.status.value, u: auth.userId.value, p: auth.profile.value, ps: auth.profileStatus.value })
    expect(exposed).not.toMatch(/Googlesson|private@gmail|googleusercontent/)
  })
})

describe('signing in with Google', () => {
  it('starts the PKCE OAuth flow with our callback and remembers where to return', async () => {
    const { client, calls } = fakeClient()
    const storage = memoryStorage()
    const auth = createAuth(client, { origin: 'https://djurgarn.example', storage })
    await auth.signInWithGoogle('/#snacket')
    const call = calls.find(c => c.method === 'signInWithOAuth')!
    expect(call.args[0]).toEqual({ provider: 'google', options: { redirectTo: 'https://djurgarn.example/auth/callback', queryParams: { prompt: 'select_account' } } })
    expect(storage.map.get(RETURN_KEY)).toBe('/#snacket')
  })

  it('never stores an off-site return address', async () => {
    const storage = memoryStorage()
    const auth = createAuth(fakeClient().client, { origin: 'https://x.test', storage })
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/auth/callback?code=x']) {
      await auth.signInWithGoogle(bad)
      expect(storage.map.get(RETURN_KEY), bad).toBe('/')
    }
  })

  it('shows a message if the flow cannot start', async () => {
    const auth = createAuth(fakeClient({ oauthError: { message: 'Unsupported provider: provider is not enabled' } }).client, { origin: 'https://x.test', storage: memoryStorage() })
    expect(await auth.signInWithGoogle()).toBe(false)
    expect(auth.error.value).toMatch(/inte påslagen/)
  })
})

describe('the OAuth callback', () => {
  it('exchanges the code, loads the profile and returns to the saved place', async () => {
    const storage = memoryStorage()
    storage.setItem(RETURN_KEY, '/#stories')
    const { client, calls } = fakeClient({ exchange: { session: session() }, profile: null })
    const auth = createAuth(client, { origin: 'https://x.test', storage })
    const r = await auth.handleCallback('https://x.test/auth/callback?code=abc123')
    expect(calls.find(c => c.method === 'exchangeCodeForSession')!.args).toEqual(['abc123'])
    expect(r).toEqual({ ok: true, returnTo: '/#stories', needsProfile: true })
    expect(auth.status.value).toBe('signed-in')
    expect(storage.map.has(RETURN_KEY)).toBe(false)
  })

  it('handles a cancelled Google consent', async () => {
    const auth = createAuth(fakeClient().client, { origin: 'https://x.test', storage: memoryStorage() })
    const r = await auth.handleCallback('https://x.test/auth/callback?error=access_denied&error_description=The+user+denied')
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/avbröts/) })
  })

  it('explains a missing code verifier (callback opened in another window, e.g. iOS home-screen app)', async () => {
    const auth = createAuth(fakeClient({ exchange: { error: { message: 'invalid request: both auth code and code verifier should be non-empty' } } }).client, { origin: 'https://x.test', storage: memoryStorage() })
    const r = await auth.handleCallback('https://x.test/auth/callback?code=abc')
    expect(r.ok).toBe(false)
    expect((r as { message: string }).message).toMatch(/annat fönster/)
    expect(auth.status.value).not.toBe('signed-in')
  })

  it('handles an expired or reused code', async () => {
    const auth = createAuth(fakeClient({ exchange: { error: { message: 'invalid flow state, no valid flow state found', code: 'flow_state_not_found' } } }).client, { origin: 'https://x.test', storage: memoryStorage() })
    expect(await auth.handleCallback('https://x.test/auth/callback?code=old')).toEqual({ ok: false, message: expect.stringMatching(/för gammal/) })
  })

  it('handles network failure during the exchange', async () => {
    const auth = createAuth(fakeClient({ exchange: { error: new TypeError('Failed to fetch') } }).client, { origin: 'https://x.test', storage: memoryStorage() })
    expect(await auth.handleCallback('https://x.test/auth/callback?code=abc')).toEqual({ ok: false, message: expect.stringMatching(/Ingen kontakt/) })
  })

  it('handles a callback page opened without a code', async () => {
    const auth = createAuth(fakeClient().client, { origin: 'https://x.test', storage: memoryStorage() })
    expect(await auth.handleCallback('https://x.test/auth/callback')).toEqual({ ok: false, message: expect.stringMatching(/ingen inloggning/) })
  })
})

describe('signing out', () => {
  it('signs out this device and forgets the profile', async () => {
    const { client, calls } = fakeClient({ session: session(), profile: row })
    const auth = createAuth(client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init(); await tick(); await auth.whenProfileLoaded()
    await auth.signOut()
    expect(calls.find(c => c.method === 'signOut')!.args).toEqual([{ scope: 'local' }])
    expect(auth.status.value).toBe('signed-out')
    expect(auth.profile.value).toBeNull()
  })

  it('still ends signed out locally when the network is down', async () => {
    const storage = memoryStorage()
    storage.setItem(AUTH_STORAGE_KEY, '{"access_token":"t"}')
    const auth = createAuth(fakeClient({ session: session(), signOutThrows: new TypeError('Failed to fetch') }).client, { origin: 'https://x.test', storage })
    await auth.init()
    await auth.signOut()
    expect(auth.status.value).toBe('signed-out')
    expect(storage.map.has(AUTH_STORAGE_KEY)).toBe(false)
  })
})

describe('saving the profile', () => {
  async function signedIn(o: Parameters<typeof fakeClient>[0]) {
    const f = fakeClient({ session: session(), ...o })
    const auth = createAuth(f.client, { origin: 'https://x.test', storage: memoryStorage() })
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

  it('refuses to save when signed out', async () => {
    const auth = createAuth(fakeClient().client, { origin: 'https://x.test', storage: memoryStorage() })
    await auth.init()
    expect(await auth.saveProfile({ displayName: 'Lotta', handle: 'lotta' })).toEqual({ ok: false, errors: { form: 'Logga in först.' } })
  })
})

describe('helpers', () => {
  it('safeReturnTo keeps same-site paths only', () => {
    expect(safeReturnTo('/#lyssna')).toBe('/#lyssna')
    expect(safeReturnTo('/?a=1')).toBe('/?a=1')
    expect(safeReturnTo(null)).toBe('/')
  })

  it('parseCallback reads query and fragment', () => {
    expect(parseCallback('https://x.test/auth/callback?code=1')).toEqual({ code: '1', error: undefined, description: undefined })
    expect(parseCallback('https://x.test/auth/callback#error=server_error&error_description=x')).toMatchObject({ error: 'server_error', description: 'x' })
  })

  it('authErrorMessage falls back to something calm', () => {
    expect(authErrorMessage({ message: 'something odd' })).toMatch(/gick inte att slutföra/)
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
