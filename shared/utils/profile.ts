/*
 * Supporter profile rules, shared by the UI and the tests. The database
 * enforces the same rules (supabase/migrations/*_profiles.sql) — this copy
 * only exists to give friendly feedback before a round trip.
 */

export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/
export const DISPLAY_NAME_MIN = 2
export const DISPLAY_NAME_MAX = 40

/** Handles that could be mistaken for the club, the site or its staff. Mirrors the SQL constraint. */
export const RESERVED_HANDLES = [
  'admin', 'administrator', 'moderator', 'support', 'system', 'official', 'officiell',
  'djurgarden', 'djurgarn', 'dif', 'difotboll', 'difhockey', 'klubben', 'snacket',
  'null', 'undefined',
] as const

/** Turn whatever someone types into a valid-looking handle: "Lotta från Gärdet" → "lotta_fran_gardet". */
export function normalizeHandle(input: string): string {
  return input
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .slice(0, 20)
}

export function validateHandle(handle: string): string | null {
  if (handle.length < 3) return 'Minst 3 tecken.'
  if (handle.length > 20) return 'Högst 20 tecken.'
  if (!HANDLE_PATTERN.test(handle)) return 'Bara a–z, siffror och understreck.'
  if ((RESERVED_HANDLES as readonly string[]).includes(handle)) return 'Det namnet är reserverat.'
  return null
}

export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length < DISPLAY_NAME_MIN) return `Minst ${DISPLAY_NAME_MIN} tecken.`
  if (trimmed.length > DISPLAY_NAME_MAX) return `Högst ${DISPLAY_NAME_MAX} tecken.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return 'Namnet innehåller otillåtna tecken.'
  return null
}

export const BIO_MAX = 160

/** Optional, one paragraph. The cleaned bio (null = none), or what's wrong. Mirrors the SQL constraints. */
export function cleanBio(input: string): { ok: true, bio: string | null } | { ok: false, error: string } {
  const bio = input.replace(/\s+/g, ' ').trim()
  if (!bio) return { ok: true, bio: null }
  if ([...bio].length > BIO_MAX) return { ok: false, error: `Högst ${BIO_MAX} tecken.` }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(bio)) return { ok: false, error: 'Texten innehåller otillåtna tecken.' }
  return { ok: true, bio }
}

/**
 * Avatar designs, drawn by the app (components/Avatar.vue). null is the
 * default: striped initials. Mirrors the SQL check on profiles.avatar.
 */
export const AVATARS = [
  { key: 'himmel', label: 'Himmelsblå ränder' },
  { key: 'tricolor', label: 'Blått, gult och rött' },
  { key: 'stjarna', label: 'Guldstjärna' },
  { key: 'halsduk', label: 'Halsduk' },
  { key: 'boll', label: 'Boll' },
  { key: 'puck', label: 'Puck' },
  { key: 'trumma', label: 'Trumma' },
] as const
export type AvatarKey = typeof AVATARS[number]['key']
export const isAvatarKey = (v: unknown): v is AvatarKey => AVATARS.some(a => a.key === v)

/** The teams a supporter can follow, whatever the feeds cover today. Mirrors the SQL check. */
export const TEAM_INTERESTS = [
  { key: 'fotboll:herr', sport: 'Fotboll', team: 'Herrar' },
  { key: 'fotboll:dam', sport: 'Fotboll', team: 'Damer' },
  { key: 'hockey:herr', sport: 'Hockey', team: 'Herrar' },
  { key: 'hockey:dam', sport: 'Hockey', team: 'Damer' },
] as const
export type TeamInterest = typeof TEAM_INTERESTS[number]['key']
export const isTeamInterest = (v: unknown): v is TeamInterest => TEAM_INTERESTS.some(t => t.key === v)

export interface SupporterProfile {
  id: string
  displayName: string
  handle: string
  bio: string | null
  avatar: AvatarKey | null
}

/** A profile row as Supabase returns it (bio and avatar may be absent before their migration). */
export interface ProfileRow { id: string, display_name: string, handle: string, bio?: string | null, avatar?: string | null }
export const toProfile = (r: ProfileRow): SupporterProfile =>
  ({ id: r.id, displayName: r.display_name, handle: r.handle, bio: r.bio ?? null, avatar: isAvatarKey(r.avatar) ? r.avatar : null })
export const PROFILE_COLUMNS = 'id, display_name, handle, bio, avatar'

/** Who wrote a post or comment, as shown next to it. `id` is the stable identity (the profile page); the handle can change. */
export interface PublicAuthor { id: string, name: string, handle: string, avatar: AvatarKey | null }
/** The embedded author of a post or comment row (avatar absent before its migration). */
export type AuthorRow = { id: string, display_name: string, handle: string, avatar?: string | null }
export const toAuthor = (a: AuthorRow): PublicAuthor => ({ id: a.id, name: a.display_name, handle: a.handle, avatar: isAvatarKey(a.avatar) ? a.avatar : null })
export const authorOf = (p: SupporterProfile): PublicAuthor => ({ id: p.id, name: p.displayName, handle: p.handle, avatar: p.avatar })
/** Before 20261105230000_supporter_profiles: a database without bio and avatar answers 42703. */
export const PROFILE_COLUMNS_BEFORE_DESIGN = 'id, display_name, handle'
