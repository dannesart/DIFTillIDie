import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

/*
 * Phones (Issue #16, P1): on a small screen or with larger text, the front
 * page's hero, the next-match card and the sport filter must stay on the
 * screen, by layout rather than by hiding what doesn't fit. These are the
 * constraints that make that true; the real check (every word and control
 * visible and tappable at 320/390/430 px, 100/125/150% text) is in the PR.
 */
interface Node { type: number, tag?: string, props?: Prop[], children?: Node[], content?: string }
interface Prop { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }

const template = (file: string) => parse(readFileSync(file, 'utf8')).descriptor.template!.ast as unknown as Node

function all(node: Node, found: Node[] = []): Node[] {
  found.push(node)
  for (const c of node.children ?? []) all(c, found)
  return found
}
const classes = (n: Node) => (n.props?.find(p => p.type === 6 && p.name === 'class')?.value?.content ?? '').split(/\s+/)
const text = (n: Node): string => n.type === 2 ? n.content ?? '' : (n.children ?? []).map(text).join('')
const withText = (root: Node, s: string) => all(root).filter(n => n.type === 1 && (n.children ?? []).some(c => c.type === 2 && c.content?.includes(s)))
const parentOf = (root: Node, child: Node) => all(root).find(n => n.children?.includes(child))!

describe('the front page hero', () => {
  const hero = template('app/components/HeroMatchday.vue')
  const grid = all(hero).find(n => classes(n).includes('grid') && classes(n).includes('max-w-7xl'))!

  it('has one column that can never be wider than the screen', () => {
    // grid-cols-1 is minmax(0, 1fr): an implicit column would grow to its widest word and take the match card with it.
    expect(classes(grid)).toContain('grid-cols-1')
  })

  it('sizes the big word to fit its column, never larger than before', () => {
    const [word] = withText(hero, 'Djurgår’n')
    const size = classes(word!).find(c => c.startsWith('text-['))!
    expect(size).toBe('text-[min(clamp(4rem,15vw,9.5rem),19cqi)]')
    // cqi is measured against the nearest container: the hero's text column.
    const column = grid.children!.find(c => c.type === 1)!
    expect(classes(column)).toContain('@container')
    expect(all(column)).toContain(word)
  })
})

describe('the phone header', () => {
  const header = template('app/components/AppHeader.vue')

  it('wraps the sport filter onto its own row instead of pushing it off the screen', () => {
    const row = all(header).find(n => n.tag === 'div' && classes(n).includes('max-w-7xl'))!
    expect(classes(row)).toContain('flex-wrap')
    expect(all(row).some(n => n.props?.some(p => p.type === 6 && p.name === 'role' && p.value?.content === 'radiogroup'))).toBe(true)
  })

  it('keeps all three sports as choices', () => {
    const src = readFileSync('app/components/AppHeader.vue', 'utf8')
    for (const label of ['Allt', 'Fotboll', 'Hockey']) expect(src).toContain(`label: '${label}'`)
  })
})

describe('the next-match card', () => {
  const card = template('app/components/MatchCard.vue')

  it('lets the source badge wrap below "Nästa match" on phones instead of cutting the label short', () => {
    const [label] = withText(card, 'Nästa match').filter(n => n.tag === 'p' && classes(n).includes('kicker'))
    expect(classes(label!)).not.toContain('truncate')
    expect(classes(label!)).toContain('lg:truncate')
    const row = parentOf(card, label!)
    expect(classes(row)).toEqual(expect.arrayContaining(['flex-wrap', 'lg:flex-nowrap']))
    const badge = all(row).find(n => n.tag === 'button')!
    expect(classes(badge)).toContain('max-w-full')
    expect(classes(badge)).not.toContain('shrink-0')
  })

  it('puts the countdown two by two when four in a row would overlap', () => {
    const grid = all(card).find(n => n.props?.some(p => p.type === 6 && p.name === 'aria-live' && p.value?.content === 'off'))!
    expect(classes(grid)).toEqual(expect.arrayContaining(['grid-cols-2', '@[14rem]:grid-cols-4']))
    expect(classes(grid)).not.toContain('grid-cols-4')
    // The query is about the countdown's own width, in rem so larger text needs more room.
    expect(classes(parentOf(card, grid))).toContain('@container')
  })

  it('breaks a team name too long for its line rather than letting it run out of the card', () => {
    // The line with the home team, " – ", and the away team.
    const teams = all(card).find(n => n.tag === 'p' && (n.children ?? []).some(c => c.tag === 'span' && text(c).includes('–')))!
    expect(classes(teams)).toContain('break-words')
  })
})

describe('no hiding', () => {
  it('fixes the layout instead of clipping the overflow', () => {
    for (const f of ['app/components/HeroMatchday.vue', 'app/components/AppHeader.vue'])
      expect(readFileSync(f, 'utf8')).not.toMatch(/overflow-x-(hidden|clip)/)
  })
})
