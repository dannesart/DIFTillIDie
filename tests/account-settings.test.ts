import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'
import { sectionLinks } from '../app/lib/sectionLinks'

/*
 * Your profile, your account menu and your settings (Issue #14, then the
 * sidebar/account iteration): going to your profile and opening the account
 * menu are separate actions; the menu holds the account's actions; settings
 * are a page of their own. Read from the components' templates, so it holds
 * however they're styled.
 */
interface Node { type: number, tag?: string, props?: Prop[], children?: Node[], content?: string }
interface Prop { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }

const template = (file: string) => parse(readFileSync(file, 'utf8')).descriptor.template!.ast as unknown as Node
const source = (file: string) => readFileSync(file, 'utf8')

function walk(node: Node, visit: (n: Node, ancestors: Node[]) => void, ancestors: Node[] = []) {
  visit(node, ancestors)
  for (const c of node.children ?? []) walk(c, visit, [...ancestors, node])
}
function find(root: Node, tag: string) {
  const found: { node: Node, ancestors: Node[] }[] = []
  walk(root, (node, ancestors) => node.tag === tag && found.push({ node, ancestors }))
  return found
}
const attr = (n: Node, name: string) => n.props?.find(p => p.name === name && p.type === 6)?.value?.content
const bound = (n: Node, name: string) => n.props?.find(p => p.type === 7 && p.arg?.content === name)?.exp?.content
const condition = (n: Node) => n.props?.find(p => p.type === 7 && (p.name === 'if' || p.name === 'else-if'))?.exp?.content
const interactive = ['button', 'a', 'NuxtLink', 'AccountSettingsButton']
const text = (n: Node): string => n.type === 2 ? n.content ?? '' : (n.children ?? []).map(text).join('')

describe('the sidebar', () => {
  const nav = template('app/shell/ShellNav.vue')
  const script = source('app/shell/ShellNav.vue')

  it('has no settings gear any more: the profile card itself opens the account menu', () => {
    expect(find(nav, 'AccountSettingsButton')).toHaveLength(0)
    const cards = find(nav, 'button').filter(b => attr(b.node, 'aria-haspopup') === 'dialog')
    // With a profile: the account menu. Signed out or choosing a name: the same dialog, to get in.
    expect(cards.map(c => condition(c.node))).toEqual(["entry.kind === 'profile' && profile", "entry.kind === 'dialog'"])
    for (const { node: card } of cards) {
      expect(card.props?.find(p => p.arg?.content === 'click')?.exp?.content).toBe('accountOpen = true')
      // Nothing else clickable inside it
      walk(card, (n) => { if (n !== card) expect(interactive).not.toContain(n.tag) })
    }
  })

  it('the card no longer links to your läktarplats (Profil does)', () => {
    expect(find(nav, 'NuxtLink').filter(l => bound(l.node, 'to') === 'entry.to')).toHaveLength(0)
  })

  it('links are content-width, fully rounded pills, with the active route and ripple kept', () => {
    const [link] = find(nav, 'nav').flatMap(n => find(n.node, 'NuxtLink'))
    const cls = attr(link!.node, 'class')!
    expect(cls).toContain('inline-flex')
    expect(cls).toContain('rounded-full')
    expect(cls).not.toMatch(/(^|\s)flex(\s|$)/)
    expect(bound(link!.node, 'aria-current')).toBe("item.here ? 'page' : undefined")
    expect(link!.node.props?.some(p => p.type === 7 && p.name === 'ripple')).toBe(true)
  })

  it('Profil only with a profile, Inställningar only when signed in', () => {
    expect(script).toMatch(/if \(e\.kind === 'profile'\) list\.push\(\{ key: 'profil'[^}]*to: e\.to/)
    expect(script).toMatch(/if \(status\.value === 'signed-in'\) list\.push\(\{ key: 'installningar'[^}]*to: links\.value\.settings/)
  })

  it('no longer has "Min läktare"', () => {
    expect(text(nav)).not.toContain('Min läktare')
  })
})

describe('the account menu', () => {
  const dialog = template('app/components/AccountDialog.vue')
  const menu = find(dialog, 'ul').find(u => attr(u.node, 'aria-label') === 'Kontomeny')!.node

  it('offers Min profil, Redigera profil, Inställningar and Logga ut, in that order', () => {
    expect(find(menu, 'li').map(li => text(li.node).trim())).toEqual(['Min profil', 'Redigera profil', 'Inställningar', 'Logga ut'])
  })

  it('reuses what exists: your place, the one profile form, the settings page, signing out', () => {
    const items = find(menu, 'li').map(li => li.node.children!.find(c => c.type === 1)!)
    expect(bound(items[0]!, 'to')).toBe('links.supporter(profile.handle)')
    expect(items[1]!.props?.find(p => p.arg?.content === 'click')?.exp?.content).toBe('editing = true')
    expect(bound(items[2]!, 'to')).toBe('links.settings')
    expect(items[3]!.props?.find(p => p.arg?.content === 'click')?.exp?.content).toBe('signOut')
  })

  it('is no settings form: no team choices in it', () => {
    expect(source('app/components/AccountDialog.vue')).not.toMatch(/MyTeams|TEAM_INTERESTS|usePreferences/)
  })
})

describe('your läktarplats', () => {
  const place = template('app/components/SupporterPlace.vue')

  it('has no "Ändra profil" (nor "Konto") button in its header', () => {
    expect(find(place, 'button').map(b => text(b.node).trim())).not.toContain('Ändra profil')
    expect(find(place, 'button').map(b => text(b.node).trim())).not.toContain('Konto')
  })

  it('no longer holds "Mina lag" (moved to /installningar)', () => {
    expect(text(place)).not.toContain('Mina lag')
    expect(source('app/components/SupporterPlace.vue')).not.toMatch(/usePreferences|TEAM_INTERESTS|MyTeams/)
  })

  it('keeps the account-menu gear on phones, on your own page only', () => {
    const gears = find(place, 'AccountSettingsButton')
    expect(gears).toHaveLength(1)
    expect(condition(gears[0]!.node)).toBe('own')
    expect(attr(gears[0]!.node, 'class')).toContain('lg:hidden')
    // Not in the decorative banner, which is hidden from screen readers.
    expect(gears[0]!.ancestors.some(a => attr(a, 'aria-hidden') === 'true')).toBe(false)
  })
})

describe('the settings gear', () => {
  const gear = template('app/components/AccountSettingsButton.vue')

  it('is a named button that opens the account menu', () => {
    const [button] = find(gear, 'button')
    expect(attr(button!.node, 'type')).toBe('button')
    expect(attr(button!.node, 'aria-label')).toBe('Inställningar och konto')
    expect(attr(button!.node, 'aria-haspopup')).toBe('dialog')
    expect(source('app/components/AccountSettingsButton.vue')).toContain('useAccountDialog()')
  })
})

describe('the settings page', () => {
  const page = template('app/shell/views/Installningar.vue')

  it('lives at /installningar, in the shell', () => {
    expect(sectionLinks('/').settings).toBe('/installningar')
    expect(source('modules/app-shell.ts')).toContain("{ name: 'installningar', path: 'installningar', file: view('Installningar') }")
  })

  it('shows "Mina lag" only when signed in with a profile; otherwise a way in, never personal data', () => {
    const [teams] = find(page, 'MyTeams')
    expect(teams).toBeDefined()
    const wrapper = teams!.ancestors.at(-1)!
    expect(condition(wrapper)).toBe("status === 'signed-in' && profileStatus === 'ready'")
    expect(text(page)).toContain('Logga in för att se dina inställningar.')
  })

  it('"Mina lag" keeps its data and behaviour: the same store, toggles and private note', () => {
    const teams = source('app/components/MyTeams.vue')
    expect(teams).toContain('usePreferences()')
    expect(teams).toContain('preferences.toggle(t.key)')
    expect(teams).toContain(':aria-pressed="preferences.teams.value.includes(t.key)"')
    expect(teams).toContain('Bara för dig')
  })
})
