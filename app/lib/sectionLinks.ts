/*
 * Where the front page's sections and supporters' pages live.
 *
 * Normally: one front page with in-page sections (/#snacket) and supporters
 * at /laktaren/<handle>. Inside the desktop app-shell prototype (/prototyp,
 * development only, see nuxt.config.ts) every section is a view of its own,
 * and shared components (posts, Stories, the mini-player, the account dialog)
 * follow along, so you stay in the prototype. Outside it, nothing changes.
 */

export type SectionId = 'hem' | 'stories' | 'snacket' | 'lyssna'

export const SHELL_BASE = '/prototyp'

const supporter = (handle: string) => `/laktaren/${handle}`

export function sectionLinks(rawPath: string) {
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath
  const shell = path === SHELL_BASE || path.startsWith(`${SHELL_BASE}/`)
  const section = (id: SectionId) => {
    if (shell) return id === 'hem' ? SHELL_BASE : `${SHELL_BASE}/${id}`
    return id === 'hem' ? '/' : `/#${id}`
  }
  return {
    /** In the app-shell prototype. */
    shell,
    /** The address of a section. */
    section,
    /** A supporter's page (by their handle). */
    supporter: (handle: string) => (shell ? SHELL_BASE : '') + supporter(handle),
    /** Is that section on the page you're on? (The front page has them all; a prototype view has one.) */
    shows: (id: SectionId) => (shell ? path === section(id) : path === '/'),
  }
}

export type SectionLinks = ReturnType<typeof sectionLinks>
