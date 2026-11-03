import { describe, expect, it } from 'vitest'
import { localOwnerFor, readScoped, resolveIdentity, scopedKey } from '../app/lib/localScope'

const HASSE = { id: 'aaaa-1', displayName: 'Hasse på Söder', handle: 'hasse' }
const LOTTA = { id: 'bbbb-2', displayName: 'Lotta från Gärdet', handle: 'lotta' }

const memoryStorage = (data: Record<string, string>) => ({ getItem: (k: string) => data[k] ?? null })

describe('whose local content', () => {
  it('is nobody\'s while auth is still restoring', () => {
    expect(localOwnerFor('loading', null)).toBeNull()
    expect(localOwnerFor('signed-in', null)).toBeNull()
  })

  it('is the guest\'s when signed out, or when sign-in isn\'t configured', () => {
    expect(localOwnerFor('signed-out', null)).toBe('guest')
    expect(localOwnerFor('unavailable', null)).toBe('guest')
  })

  it('is the account\'s own when signed in', () => {
    expect(localOwnerFor('signed-in', 'aaaa-1')).toBe('account:aaaa-1')
  })

  it('keeps the guest on the original storage key, and gives every account its own', () => {
    expect(scopedKey('djurgarn:snacket:v1', 'guest')).toBe('djurgarn:snacket:v1')
    expect(scopedKey('djurgarn:snacket:v1', 'account:aaaa-1')).toBe('djurgarn:snacket:v1:account:aaaa-1')
    expect(scopedKey('djurgarn:snacket:v1', 'account:bbbb-2')).not.toBe(scopedKey('djurgarn:snacket:v1', 'account:aaaa-1'))
  })
})

describe('who you post as', () => {
  it('a guest has no author identity: they read, and are invited to sign in', () => {
    expect(resolveIdentity('guest', null, 'idle')).toEqual({ kind: 'guest' })
  })

  it('a signed-in supporter posts under their own profile', () => {
    const id = resolveIdentity('account:aaaa-1', HASSE, 'ready')
    expect(id).toEqual({ kind: 'member', author: { name: 'Hasse på Söder', handle: 'hasse' } })
  })

  it('without a complete profile, a signed-in supporter can\'t post yet', () => {
    expect(resolveIdentity('account:aaaa-1', null, 'missing')).toEqual({ kind: 'needs-profile' })
    expect(resolveIdentity('account:aaaa-1', null, 'error')).toEqual({ kind: 'needs-profile' })
    expect(resolveIdentity('account:aaaa-1', null, 'loading')).toEqual({ kind: 'pending' })
    expect(resolveIdentity('account:aaaa-1', null, 'idle')).toEqual({ kind: 'pending' })
    expect(resolveIdentity(null, null, 'idle')).toEqual({ kind: 'pending' })
  })

  it('never shows one account\'s profile on another account\'s content', () => {
    // E.g. mid-switch: Lotta's bucket is loaded, but Hasse's profile hasn't been replaced yet.
    expect(resolveIdentity('account:bbbb-2', HASSE, 'ready')).toEqual({ kind: 'pending' })
    expect(resolveIdentity('account:bbbb-2', LOTTA, 'ready').author?.handle).toBe('lotta')
  })
})

describe('reading a bucket', () => {
  const fresh = () => ({ posts: [] as string[], me: 'Du' })

  it('reads the owner\'s data, filling in anything missing', () => {
    const s = memoryStorage({ k: JSON.stringify({ posts: ['a'] }) })
    expect(readScoped(s, 'k', fresh)).toEqual({ posts: ['a'], me: 'Du' })
  })

  it('starts fresh when empty, corrupt or unavailable', () => {
    expect(readScoped(memoryStorage({}), 'k', fresh)).toEqual(fresh())
    expect(readScoped(memoryStorage({ k: '{nope' }), 'k', fresh)).toEqual(fresh())
    expect(readScoped(undefined, 'k', fresh)).toEqual(fresh())
    expect(readScoped({ getItem: () => { throw new Error('blocked') } }, 'k', fresh)).toEqual(fresh())
  })
})
