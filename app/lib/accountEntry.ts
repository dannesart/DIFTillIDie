import type { AuthStatus, ProfileStatus } from './auth'

/*
 * Where "you" leads: the desktop sidebar's profile card and the phones'
 * "Du" tab ask the same question (Issue #14). With a profile, your own
 * läktarplats; the account dialog ("Ditt konto": Ändra profil, Logga ut) is
 * one click from there. Without one (signed out, choosing a name, still
 * loading or failed), the account dialog, as before. No sign-in at all here:
 * nothing.
 */
export type AccountEntry =
  | { kind: 'profile', to: string }
  | { kind: 'dialog' }
  | { kind: 'none' }

export function accountEntry(
  status: AuthStatus,
  profileStatus: ProfileStatus,
  handle: string | null | undefined,
  supporter: (handle: string) => string,
): AccountEntry {
  if (status === 'unavailable') return { kind: 'none' }
  if (status === 'signed-in' && profileStatus === 'ready' && handle) return { kind: 'profile', to: supporter(handle) }
  return { kind: 'dialog' }
}
