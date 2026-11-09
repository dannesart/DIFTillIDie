import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

/*
 * Going to your profile and opening your settings are separate actions
 * (Issue #14): the settings gear sits beside the profile link, never inside
 * it, and only where the card itself isn't already the way to the dialog.
 * Read from the components' templates, so it holds however they're styled.
 */
interface Node { type: number, tag?: string, props?: Prop[], children?: Node[], content?: string }
interface Prop { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }

const template = (file: string) => parse(readFileSync(file, 'utf8')).descriptor.template!.ast as unknown as Node

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
const condition = (n: Node) => n.props?.find(p => p.type === 7 && (p.name === 'if' || p.name === 'else-if'))?.exp?.content
const interactive = ['button', 'a', 'NuxtLink', 'AccountSettingsButton']
const text = (n: Node): string => n.type === 2 ? n.content ?? '' : (n.children ?? []).map(text).join('')

describe('the sidebar: profile and settings side by side', () => {
  const nav = template('app/shell/ShellNav.vue')

  it('has one settings gear, shown with the profile link, beside it and not inside it', () => {
    const gears = find(nav, 'AccountSettingsButton')
    expect(gears).toHaveLength(1)
    const { ancestors } = gears[0]!
    expect(ancestors.some(a => interactive.includes(a.tag!))).toBe(false)
    const row = ancestors.at(-1)!
    expect(condition(row)).toContain("entry.kind === 'profile'")
    expect(row.children!.filter(c => c.type === 1).map(c => c.tag)).toEqual(['NuxtLink', 'AccountSettingsButton'])
  })

  it('keeps the profile link free of other controls', () => {
    const links = find(nav, 'NuxtLink').filter(l => l.node.props?.some(p => p.arg?.content === 'to' && p.exp?.content === 'entry.to'))
    expect(links).toHaveLength(1)
    for (const { node } of links) {
      walk(node, (n) => { if (n !== node) expect(interactive).not.toContain(n.tag) })
    }
  })

  it('no longer has "Min läktare"', () => {
    expect(text(nav)).not.toContain('Min läktare')
  })
})

describe('your läktarplats', () => {
  const place = template('app/components/SupporterPlace.vue')

  it('keeps "Ändra profil" and has no "Konto" button in its header', () => {
    expect(text(place)).toContain('Ändra profil')
    expect(find(place, 'button').map(b => text(b.node).trim())).not.toContain('Konto')
  })

  it('offers the settings gear on phones, on your own page only', () => {
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

  it('is a named button that opens the account dialog', () => {
    const [button] = find(gear, 'button')
    expect(attr(button!.node, 'type')).toBe('button')
    expect(attr(button!.node, 'aria-label')).toBe('Inställningar och konto')
    expect(attr(button!.node, 'aria-haspopup')).toBe('dialog')
    expect(readFileSync('app/components/AccountSettingsButton.vue', 'utf8')).toContain('useAccountDialog()')
  })
})
