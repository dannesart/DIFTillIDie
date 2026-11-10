import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

/*
 * Issue #16: phones have the same pages as desktop. The bottom nav goes to
 * /, /snacket, /stories and /lyssna (real routes, in the history), its
 * active tab follows the address, and Hem is an overview rather than every
 * section in one long page. The browser checks (URL, back/forward, focus,
 * legacy links, playback across pages) are in the PR.
 */
interface Node { type: number, tag?: string, props?: Prop[], children?: Node[] }
interface Prop { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }

const source = (file: string) => readFileSync(file, 'utf8')
const template = (file: string) => parse(source(file)).descriptor.template!.ast as unknown as Node
const script = (file: string) => parse(source(file)).descriptor.scriptSetup!.content
function all(node: Node, found: Node[] = []): Node[] {
  found.push(node)
  for (const c of node.children ?? []) all(c, found)
  return found
}
const bound = (n: Node, name: string) => n.props?.find(p => p.type === 7 && p.name === 'bind' && p.arg?.content === name)?.exp?.content
const attr = (n: Node, name: string) => n.props?.find(p => p.type === 6 && p.name === name)?.value?.content

describe('the bottom nav', () => {
  const nav = template('app/components/MobileNav.vue')
  const tab = all(nav).find(n => n.props?.some(p => p.type === 7 && p.name === 'for' && p.exp?.content.includes('items')))!
  const link = tab.children!.find(n => n.type === 1)!

  it('has the four pages, in order', () => {
    const items = script('app/components/MobileNav.vue').match(/\{ id: '(\w+)', label: '(\w+)' \}/g)
    expect(items).toEqual([
      "{ id: 'hem', label: 'Hem' }",
      "{ id: 'stories', label: 'Stories' }",
      "{ id: 'snacket', label: 'Snacket' }",
      "{ id: 'lyssna', label: 'Lyssna' }",
    ])
  })

  it('links each tab to its page, a real route', () => {
    expect(link.tag).toBe('NuxtLink')
    expect(bound(link, 'to')).toBe('links.view(item.id)')
    expect(attr(link, 'href')).toBeUndefined()
  })

  it('marks the page you are on, by its address, not by where you have scrolled', () => {
    expect(bound(link, 'aria-current')).toBe("links.here(item.id) ? 'page' : undefined")
    const src = script('app/components/MobileNav.vue')
    expect(src).not.toMatch(/scrollIntoView|replaceState|addEventListener\('scroll'/)
  })

  it('keeps "Du": your page once you have a profile, otherwise the account dialog', () => {
    const du = all(nav).find(n => n.tag === 'NuxtLink' && bound(n, 'to') === 'entry.to')!
    expect(du.props!.some(p => p.type === 7 && p.name === 'if' && p.exp?.content === "entry.kind === 'profile'")).toBe(true)
    expect(all(nav).some(n => n.tag === 'button' && attr(n, 'aria-haspopup') === 'dialog')).toBe(true)
  })

  it('is marked, so focus can follow a tap to the new page', () => {
    const bar = all(nav).find(n => n.tag === 'nav')!
    expect(bar.props!.some(p => p.type === 6 && p.name === 'data-nav-focus')).toBe(true)
    expect(source('app/shell/AppShell.vue')).toContain("closest('[data-nav-focus]')")
  })
})

describe('Hem', () => {
  it('is the same overview on every screen size, not every section in one page', () => {
    const home = template('app/shell/views/Home.vue')
    const tags = all(home).map(n => n.tag)
    expect(tags).toContain('Hem')
    for (const gone of ['HomeSections', 'SnacketSection', 'StorySection', 'MediaSection'])
      expect(tags).not.toContain(gone)
  })

  it('shows the four newest episodes on phones, where there is no rail', () => {
    const latest = all(template('app/shell/views/Hem.vue')).find(n => n.tag === 'LatestEpisodes')!
    expect(attr(latest, 'class')).toContain('lg:hidden')
    expect(source('app/components/LatestEpisodes.vue')).toContain('.slice(0, 4))')
    // The same list as the rail's, not a second one
    expect(all(template('app/shell/ShellRail.vue')).some(n => n.tag === 'LatestEpisodes')).toBe(true)
  })
})

describe('page titles', () => {
  it('name each page, with the site', () => {
    const titles = {
      Home: 'Hem – Djurgår’n tills jag dör',
      Snacket: 'Snacket på stan – Djurgår’n tills jag dör',
      Stories: 'Stories – Djurgår’n tills jag dör',
      Lyssna: 'Lyssna & titta – Djurgår’n tills jag dör',
    }
    for (const [view, title] of Object.entries(titles))
      expect(script(`app/shell/views/${view}.vue`)).toContain(`useHead({ title: '${title}' })`)
  })
})

describe('no more one-page links', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(vue|ts)$/.test(f) ? [p] : []
  })

  it('in the app: every section is reached by its page', () => {
    // A link to a section of the front page: '/#snacket', `/#${…}`, href="#stories", …
    const oneSection = /(['"`]\/#(snacket|stories|lyssna|hem|story-|post-|\$\{))|(href="#(snacket|stories|lyssna|hem)")/
    const offenders = [...files('app'), ...files('server')].filter(f => oneSection.test(source(f)))
    expect(offenders).toEqual([])
  })

  it("in an installed app's shortcuts", () => {
    const { shortcuts } = JSON.parse(source('public/manifest.webmanifest')) as { shortcuts: { url: string }[] }
    expect(shortcuts.map(s => s.url).sort()).toEqual(['/lyssna', '/snacket', '/stories'])
  })
})
