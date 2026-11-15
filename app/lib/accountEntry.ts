import type { AuthStatus, ProfileStatus } from './auth'

/*
 * Where "you" leads (Issue #14). With a profile, your own läktarplats: the
 * phones' "Du" tab and the desktop sidebar's "Profil" link (the sidebar's
 * profile card always opens the account menu instead). Without one (signed
 * out, choosing a name, still loading or failed), the account dialog. No
 * sign-in at all here: nothing.
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
