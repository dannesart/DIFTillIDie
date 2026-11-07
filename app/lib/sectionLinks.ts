/*
 * Where the front page's sections and supporters' pages live.
 *
 * The site is laid out by the app shell (Mission #17, see
 * modules/app-shell.ts). Phones and tablets have one front page with in-page
 * sections (/#snacket); desktop has a view per section (/snacket, /stories,
 * /lyssna) with Hem's overview at /. Supporters are at /laktaren/<handle>.
 * Shared links stay the classic hash links, which work on every screen; on
 * desktop they are turned into the views (desktopTarget below).
 */

export type SectionId = 'hem' | 'stories' | 'snacket' | 'lyssna'

export const VIEWS = ['snacket', 'stories', 'lyssna'] as const

/** Tailwind's lg: where the shell's sidebars, and its views, begin. */
export const DESKTOP_QUERY = '(min-width: 64rem)'
export const MOBILE_QUERY = 'not all and (min-width: 64rem)'

const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

export interface SectionLinkOptions {
  /** Is the screen desktop-sized right now? Asked only when a link is followed, never while rendering. */
  desktop?: () => boolean
}

export function sectionLinks(rawPath: string, { desktop = () => false }: SectionLinkOptions = {}) {
  const path = trim(rawPath)
  /** A section's own view in the shell (desktop sidebars, Hem's previews). */
  const view = (id: SectionId) => (id === 'hem' ? '/' : `/${id}`)
  /** A section's address for links on every screen size. */
  const section = (id: SectionId) => (id === 'hem' ? '/' : `/#${id}`)
  const here = (id: SectionId) => path === view(id)
  return {
    section,
    view,
    /** A Story, on the page where the Stories are. */
    story: (id: string) => `/#${id}`,
    /** A supporter's page (by their handle). */
    supporter: (handle: string) => `/laktaren/${handle}`,
    /** Is this the section's own view? (For the shell's sidebar: by address alone, so it renders the same everywhere.) */
    here,
    /**
     * Is that section on the screen you're looking at? For click handlers
     * only. A phone's front page has them all; desktop's front page is Hem's
     * overview, and each section has its own view.
     */
    shows: (id: SectionId) => (desktop() ? here(id) : path === '/'),
  }
}

export type SectionLinks = ReturnType<typeof sectionLinks>

/**
 * On desktop: where a classic link to a front-page section really goes.
 * /#snacket → /snacket, /#story-… → /stories#story-…,
 * /#post-… → /snacket#post-…; anything else (Hem, another page) stays put.
 */
export function desktopTarget(path: string, hash: string): { path: string, hash?: string } | null {
  if (trim(path) !== '/' || !hash) return null
  const id = hash.replace(/^#/, '')
  if ((VIEWS as readonly string[]).includes(id)) return { path: `/${id}` }
  if (id.startsWith('story-')) return { path: '/stories', hash: `#${id}` }
  if (id.startsWith('post-')) return { path: '/snacket', hash: `#${id}` }
  return null
}
