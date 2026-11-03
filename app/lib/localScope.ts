import type { PostAuthor } from '#shared/types/domain'
import type { SupporterProfile } from '#shared/utils/profile'
import type { AuthStatus, ProfileStatus } from './auth'

/*
 * Whose local Snacket content is this? Posts, comments, reactions and drafts
 * are stored per owner: the guest keeps the original storage keys (so existing
 * data stays put), and every signed-in account gets its own. Switching account
 * on a shared browser therefore never shows, or re-attributes, someone else's
 * local content.
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
 * Who you post as. A guest posts under their local guest name; a signed-in
 * supporter only under their own, complete profile, never the guest name.
 */
export type SnacketIdentity =
  | { kind: 'guest' | 'member', author: PostAuthor }
  | { kind: 'pending' | 'needs-profile', author?: undefined }

export function resolveIdentity(
  owner: LocalOwner | null,
  guest: PostAuthor,
  profile: SupporterProfile | null,
  profileStatus: ProfileStatus,
): SnacketIdentity {
  if (!owner) return { kind: 'pending' }
  if (owner === 'guest') return { kind: 'guest', author: guest }
  if (profileStatus === 'ready' && profile && owner === `account:${profile.id}`) {
    return { kind: 'member', author: { name: profile.displayName, handle: profile.handle } }
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
