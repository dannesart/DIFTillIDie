import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

/*
 * Phones (Issue #16): on a small screen or with larger text, the
 * next-match card, the sport filter, Snacket and the Stories must stay on the screen,
 * by layout rather than by hiding what doesn't fit. These are the
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

describe('Hem\'s hero', () => {
  const hem = template('app/shell/views/Hem.vue')

  it('sizes the big word to fit its band, never larger than before', () => {
    // About 5em wide and unbreakable, in a band that clips: as large as before (3rem, 3.75rem from sm),
    // but never wider than the band's width (cqi of Hem's @container) inside its padding. Line height 1, as text-5xl/6xl had.
    const [word] = withText(hem, 'Djurgår’n')
    expect(classes(word!)).toEqual(expect.arrayContaining([
      'leading-none',
      'text-[min(3rem,calc((100cqi_-_3rem)/5.2))]',
      'sm:text-[min(3.75rem,calc((100cqi_-_4rem)/5.2))]',
    ]))
    const container = all(hem).find(n => classes(n).includes('@container'))!
    expect(all(container)).toContain(word)
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

describe('Snacket', () => {
  const section = template('app/components/SnacketSection.vue')
  const card = template('app/components/PostCard.vue')
  const header = all(card).find(n => n.tag === 'header')!

  it('has one column on phones that can never be wider than the screen', () => {
    // Signed in, the "Du på läktaren" row has a wide min-content; an implicit column grew to it and took the feed along.
    const grid = parentOf(section, all(section).find(n => n.tag === 'aside')!)
    expect(classes(grid)).toEqual(expect.arrayContaining(['grid', 'grid-cols-1']))
  })

  it('lets a post\'s own actions wrap below the author instead of running out of the card', () => {
    expect(classes(header)).toContain('flex-wrap')
    // "Ja, ta bort för alla" / "Avbryt", shown while confirming
    const confirm = all(header).find(n => n.props?.some(p => p.type === 7 && p.name === 'if' && p.exp?.content === 'confirming'))!
    expect(classes(confirm)).toEqual(expect.arrayContaining(['flex-wrap', 'max-w-full', 'ml-auto']))
    expect(classes(confirm)).not.toContain('shrink-0')
    const [remove] = withText(header, 'Ta bort').filter(n => n.tag === 'button')
    expect(classes(remove!)).toContain('ml-auto')
  })

  it('keeps the avatar and name together, at a width that grows with the text', () => {
    // Wrapping breaks between the header's children: the author is one of them, so it never splits.
    const author = header.children!.find(n => n.type === 1)!
    expect(classes(author)).toEqual(expect.arrayContaining(['flex', 'min-w-0', 'flex-[1_1_12rem]']))
    expect(all(author).some(n => n.tag === 'Avatar')).toBe(true)
    expect(all(author).some(n => n.tag === 'TimeAgo')).toBe(true)
  })
})

describe('a Story card', () => {
  const card = template('app/components/StoryCard.vue')
  // The "Fler källor om samma händelse" list
  const [othersLabel] = withText(card, 'Fler källor om samma händelse')
  const others = parentOf(card, othersLabel!)
  const sourceRow = all(others).find(n => n.tag === 'a')!

  it('breaks a word too long for the card rather than letting the card cut it off', () => {
    // The card clips (overflow-hidden, for the lead's stripe field), so a long Swedish compound must break inside it.
    const headline = all(card).find(n => n.tag === 'h3')!
    expect(classes(headline)).toContain('break-words')
    const excerpt = all(card).find(n => n.tag === 'p' && n.props?.some(p => p.type === 7 && p.name === 'if' && p.exp?.content === 'leadSource.excerpt'))!
    expect(classes(excerpt)).toContain('break-words')
    const otherHeadline = all(sourceRow).find(n => n.tag === 'span' && classes(n).includes('font-display'))!
    expect(classes(otherHeadline)).toContain('break-words')
  })

  it('puts another source\'s headline beside its outlet only when the card itself has room', () => {
    // A card is a third of the page on desktop and the outlet column grows with the text: the screen's width says nothing about that.
    expect(classes(others)).toContain('@container')
    expect(classes(sourceRow)).toEqual(expect.arrayContaining(['flex-col', 'sm:@[15rem]:flex-row']))
    const outlet = sourceRow.children!.find(n => n.type === 1)!
    expect(classes(outlet)).toContain('sm:@[15rem]:w-28')
    for (const n of [sourceRow, outlet]) expect(classes(n).filter(c => /^sm:(flex-row|w-28|items-baseline|gap-4)$/.test(c))).toEqual([])
  })

  it('wraps the label line on phones instead of cutting sport, outlet or "sammanställning" short', () => {
    const [label] = all(card).filter(n => n.tag === 'span' && classes(n).includes('kicker') && text(n).includes('sammanställning'))
    expect(classes(label!)).not.toContain('truncate')
    expect(classes(label!)).toEqual(expect.arrayContaining(['lg:truncate', 'break-words']))
    // The dot and label stay together, with room for the label's longest word beside the time
    const group = parentOf(card, label!)
    expect(classes(group)).toEqual(expect.arrayContaining(['min-w-0', 'flex-[1_1_10rem]', 'lg:flex-initial']))
    const row = parentOf(card, group)
    expect(classes(row)).toEqual(expect.arrayContaining(['flex-wrap', 'lg:flex-nowrap']))
    // The time, at the row's end
    expect(all(row).some(n => n.tag === 'TimeAgo')).toBe(true)
  })
})

describe('no hiding', () => {
  it('fixes the layout instead of clipping the overflow', () => {
    for (const f of ['app/shell/views/Hem.vue', 'app/components/AppHeader.vue', 'app/components/SnacketSection.vue', 'app/components/PostCard.vue', 'app/components/StoryCard.vue'])
      expect(readFileSync(f, 'utf8')).not.toMatch(/overflow-x-(hidden|clip)/)
  })
})
