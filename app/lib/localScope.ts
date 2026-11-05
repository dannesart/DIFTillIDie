import type { PostAuthor } from '#shared/types/domain'
import type { SupporterProfile } from '#shared/utils/profile'
import type { AuthStatus, ProfileStatus } from './auth'

/*
 * Whose browser-local content is this? Story drafts are stored per owner:
 * the guest keeps the original storage key, and every signed-in account gets
 * its own. Switching account on a shared browser therefore never shows, or
 * re-attributes, someone else's draft.
 */
export type LocalOwner = 'guest' | `account:${string}`

/** Null while we don't know yet (auth still restoring): show no local content then. */
export function localOwnerFor(status: AuthStatus, userId: string | null): LocalOwner | null {
  if (status === 'signed-in') return userId ? `account:${userId}` : null
  if (status === 'signed-out' || status === 'unavailable') return 'guest'
  return null
}

export const scopedKey = (base: string, owner: LocalOwner) => (owner === 'guest' ? base : `${base}:${owner}`)

/**
 * Who you post as. Only a signed-in supporter with their own, complete
 * profile has an author identity; a guest reads, and is invited to sign in.
 */
export type SnacketIdentity =
  | { kind: 'member', author: PostAuthor }
  | { kind: 'guest' | 'pending' | 'needs-profile', author?: undefined }

export function resolveIdentity(
  owner: LocalOwner | null,
  profile: SupporterProfile | null,
  profileStatus: ProfileStatus,
): SnacketIdentity {
  if (!owner) return { kind: 'pending' }
  if (owner === 'guest') return { kind: 'guest' }
  if (profileStatus === 'ready' && profile && owner === `account:${profile.id}`) {
    return { kind: 'member', author: { name: profile.displayName, handle: profile.handle, avatar: profile.avatar ?? undefined } }
  }
  return { kind: profileStatus === 'missing' || profileStatus === 'error' ? 'needs-profile' : 'pending' }
}

/** Read one owner's JSON bucket; anything unreadable starts fresh. */
export function readScoped<T extends object>(storage: Pick<Storage, 'getItem'> | undefined, key: string, fresh: () => T): T {
  try {
    const raw = storage?.getItem(key)
    if (raw) return { ...fresh(), ...JSON.parse(raw) }
  }
  catch { /* private mode or corrupt data */ }
  return fresh()
}
