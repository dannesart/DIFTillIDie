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

export interface SupporterProfile {
  id: string
  displayName: string
  handle: string
}
