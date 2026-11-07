/*
 * Where the front page's sections and supporters' pages live.
 *
 * Three ways the site can be laid out:
 *  - classic (today's production): one front page with in-page sections
 *    (/#snacket) and supporters at /laktaren/<handle>;
 *  - the desktop app shell (Mission #17, switched on with APP_SHELL=1, see
 *    modules/app-shell.ts): the same pages, plus a view per section on
 *    desktop (/snacket, /stories, /lyssna). Phones keep the classic front
 *    page, so shared links stay the classic hash links, which work on every
 *    screen; on desktop they are turned into the views (desktopTarget below);
 *  - the development prototype under /prototyp, where every link stays inside.
 */

export type SectionId = 'hem' | 'stories' | 'snacket' | 'lyssna'

export const SHELL_BASE = '/prototyp'
export const VIEWS = ['snacket', 'stories', 'lyssna'] as const

/** Tailwind's lg: where the shell's sidebars, and its views, begin. */
export const DESKTOP_QUERY = '(min-width: 64rem)'
export const MOBILE_QUERY = 'not all and (min-width: 64rem)'

const supporter = (handle: string) => `/laktaren/${handle}`
const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

export interface SectionLinkOptions {
  /** The app shell is switched on (APP_SHELL=1). */
  shell?: boolean
  /** Is the screen desktop-sized right now? Asked only when a link is followed, never while rendering. */
  desktop?: () => boolean
}

export function sectionLinks(rawPath: string, { shell = false, desktop = () => false }: SectionLinkOptions = {}) {
  const path = trim(rawPath)
  const prototype = path === SHELL_BASE || path.startsWith(`${SHELL_BASE}/`)
  const base = prototype ? SHELL_BASE : ''
  /** A section's own view in the shell (desktop sidebars, Hem's previews). */
  const view = (id: SectionId) => (id === 'hem' ? base || '/' : `${base}/${id}`)
  /** A section's address for links on every screen size. */
  const section = (id: SectionId) => (prototype ? view(id) : id === 'hem' ? '/' : `/#${id}`)
  const here = (id: SectionId) => (prototype || shell) && path === view(id)
  return {
    /** The page is laid out by the app shell (its sidebars show from lg up). */
    shell: prototype || shell,
    /** Inside the development prototype. */
    prototype,
    section,
    view,
    /** A Story, on the page where the Stories are. */
    story: (id: string) => (prototype ? `${view('stories')}#${id}` : `/#${id}`),
    /** A supporter's page (by their handle). */
    supporter: (handle: string) => base + supporter(handle),
    /** Is this the section's own view? (For the shell's sidebar: by address alone, so it renders the same everywhere.) */
    here,
    /**
     * Is that section on the screen you're looking at? For click handlers
     * only. The classic front page has them all, on desktop and on phones;
     * with the shell, desktop's front page is Hem's overview instead.
     */
    shows: (id: SectionId) => {
      if (prototype) return here(id)
      if (shell && desktop()) return here(id)
      return path === '/'
    },
  }
}

export type SectionLinks = ReturnType<typeof sectionLinks>

/**
 * With the shell on desktop: where a classic link to a front-page section
 * really goes. /#snacket → /snacket, /#story-… → /stories#story-…,
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
