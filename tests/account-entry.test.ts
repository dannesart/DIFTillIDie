import { describe, expect, it } from 'vitest'
import type { ProfileStatus } from '../app/lib/auth'
import { accountEntry } from '../app/lib/accountEntry'
import { sectionLinks } from '../app/lib/sectionLinks'

/*
 * Where "you" leads, in the desktop sidebar's profile card and the phones'
 * "Du" tab (Issue #14). Signing out is in auth.test.ts.
 */
const supporter = sectionLinks('/').supporter

describe('the profile entry point', () => {
  it('leads a supporter with a profile to their own läktarplats, by handle', () => {
    expect(accountEntry('signed-in', 'ready', 'kaminen81', supporter)).toEqual({ kind: 'profile', to: '/laktaren/kaminen81' })
  })

  it('opens the account dialog to sign in when signed out, or while the session is checked', () => {
    expect(accountEntry('signed-out', 'idle', null, supporter)).toEqual({ kind: 'dialog' })
    expect(accountEntry('loading', 'idle', null, supporter)).toEqual({ kind: 'dialog' })
  })

  it('opens the account dialog (choose a name, retry, Logga ut) until there is a profile to go to', () => {
    for (const s of ['idle', 'loading', 'missing', 'error'] as ProfileStatus[])
      expect(accountEntry('signed-in', s, null, supporter)).toEqual({ kind: 'dialog' })
  })

  it('never links to a stale handle: only a ready profile is a destination', () => {
    // A failed reload keeps the last profile in memory; the dialog says so and offers a retry.
    expect(accountEntry('signed-in', 'error', 'kaminen81', supporter)).toEqual({ kind: 'dialog' })
    expect(accountEntry('signed-in', 'ready', '', supporter)).toEqual({ kind: 'dialog' })
  })

  it('shows nothing where sign-in is not switched on', () => {
    expect(accountEntry('unavailable', 'idle', null, supporter)).toEqual({ kind: 'none' })
  })
})
