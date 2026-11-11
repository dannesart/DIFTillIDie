import { postAnchor } from './reveal'

/*
 * Where the site's sections and supporters' pages live.
 *
 * The site is laid out by the app shell (Mission #17, see
 * modules/app-shell.ts). Every section is a page of its own on every screen
 * size (Issue #16): Hem at /, and /snacket, /stories, /lyssna. Supporters
 * are at /laktaren/<handle>. A Story or a post is its section's page with
 * the item's anchor (/stories#story-…, /snacket#post-…).
 *
 * Until Issue #16 phones had one long front page with in-page sections
 * (/#snacket). Those addresses are still out there (shared links, bookmarks,
 * installed apps' shortcuts), so they are sent on to the pages (legacyTarget).
 */

export type SectionId = 'hem' | 'stories' | 'snacket' | 'lyssna'

export const VIEWS = ['snacket', 'stories', 'lyssna'] as const

/** Tailwind's lg: where the shell's sidebars begin. */
export const DESKTOP_QUERY = '(min-width: 64rem)'
export const MOBILE_QUERY = 'not all and (min-width: 64rem)'

const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

export function sectionLinks(rawPath: string) {
  const path = trim(rawPath)
  /** A section's page. */
  const view = (id: SectionId) => (id === 'hem' ? '/' : `/${id}`)
  const here = (id: SectionId) => path === view(id)
  return {
    view,
    /** A section's page (the same as `view`; kept for the links that go "to a section"). */
    section: view,
    /** A Story, on the Stories page. */
    story: (id: string) => `/stories#${id}`,
    /** A post, in Snacket. */
    post: (id: string) => `/snacket#${postAnchor(id)}`,
    /** A supporter's page (by their handle). */
    supporter: (handle: string) => `/laktaren/${handle}`,
    /** Is this the section's own page? By address alone, so it renders the same everywhere. */
    here,
    /** Is that section on the page you're looking at? (Then scroll to it rather than go there.) */
    shows: here,
  }
}

export type SectionLinks = ReturnType<typeof sectionLinks>

/**
 * Where an old address of the one-page front page goes now:
 * /#snacket → /snacket, /#story-… → /stories#story-…,
 * /#post-… → /snacket#post-…, /#hem → /. Anything else stays put.
 */
export function legacyTarget(path: string, hash: string): { path: string, hash?: string } | null {
  if (trim(path) !== '/' || !hash) return null
  const id = hash.replace(/^#/, '')
  if (id === 'hem') return { path: '/' }
  if ((VIEWS as readonly string[]).includes(id)) return { path: `/${id}` }
  if (id.startsWith('story-')) return { path: '/stories', hash: `#${id}` }
  if (id.startsWith('post-')) return { path: '/snacket', hash: `#${id}` }
  return null
}
