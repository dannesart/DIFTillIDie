import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

/*
 * Quick posting from Hem, and the läktarplats header's numbers. Read from the
 * templates, so it holds however they're styled.
 */
interface Node { type: number, tag?: string, props?: Prop[], children?: Node[], content?: string }
interface Prop { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }

const template = (file: string) => parse(readFileSync(file, 'utf8')).descriptor.template!.ast as unknown as Node
const source = (file: string) => readFileSync(file, 'utf8')
const all = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(all)]
const attr = (n: Node, name: string) => n.props?.find(p => p.name === name && p.type === 6)?.value?.content
const bound = (n: Node, name: string) => n.props?.find(p => p.type === 7 && (p.arg?.content === name || p.name === name))?.exp?.content
const text = (n: Node): string => n.type === 2 ? n.content ?? '' : (n.children ?? []).map(text).join('')

describe('the compose entry', () => {
  const entry = template('app/components/ComposeEntry.vue')

  it('is one button that opens the existing compose dialog, never a form of its own', () => {
    const buttons = all(entry).filter(n => n.tag === 'button')
    expect(buttons).toHaveLength(1)
    expect(attr(buttons[0]!, 'aria-haspopup')).toBe('dialog')
    expect(bound(buttons[0]!, 'click')).toBe('compose.openPost(browsing())')
    expect(all(entry).some(n => ['form', 'textarea', 'input'].includes(n.tag!))).toBe(false)
    expect(source('app/components/ComposeEntry.vue')).not.toMatch(/publish|insert\(|\.rpc\(/)
  })

  it('is the same entry in Snacket (no second copy of it)', () => {
    const snacket = template('app/components/SnacketSection.vue')
    expect(all(snacket).filter(n => n.tag === 'ComposeEntry').map(n => bound(n, 'story'))).toEqual(['filterStory'])
    expect(source('app/components/SnacketSection.vue')).not.toContain('Vad snackas det om på stan?')
  })
})

describe('Hem', () => {
  const hem = template('app/shell/views/Hem.vue')

  it('invites you to write, near the top: right after the hero, before the overview', () => {
    const root = all(hem).find(n => attr(n, 'class') === '@container')!
    const kids = root.children!.filter(c => c.type === 1)
    expect(kids[0]!.tag).toBe('section') // the hero
    expect(kids[1]!.tag).toBe('ComposeEntry')
    expect(attr(kids[1]!, 'prompt')).toBe('Vad händer på läktaren?')
    expect(kids[1]!.props?.some(p => p.name === 'compact')).toBe(true)
  })
})

describe('the läktarplats header', () => {
  const place = template('app/components/SupporterPlace.vue')
  const script = source('app/components/SupporterPlace.vue')
  const name = all(place).find(n => attr(n, 'id') === 'supporter-name')!
  const row = all(place).find(n => n.children?.some(c => c.children?.includes(name)))!

  it('shows the identity and, beside it, the numbers (wrapping beneath on a narrow screen)', () => {
    expect(attr(row, 'class')).toContain('flex-wrap')
    expect(attr(row, 'class')).toContain('justify-between')
    const stats = row.children!.find(c => c.tag === 'dl')!
    expect(bound(stats, 'if')).toBe('stats.length')
    expect(attr(stats, 'class')).toContain('flex-wrap')
  })

  it('Snack, Följare and Följer, each only as the database gave it (never a made-up number or a guessed zero)', () => {
    expect(script).toContain("if (total.value !== null) list.push({ key: 'snack', label: 'Snack', value: total.value })")
    expect(script).toContain('const c = wall.id.value ? follows.counts.value[wall.id.value] : undefined')
    expect(script).toContain("if (c) list.push({ key: 'followers', label: 'Följare', value: c.followers }, { key: 'following', label: 'Följer', value: c.following, opens: own.value })")
    // Without counts, only your own place shows "Följer", as the length of your own list (the same people)
    expect(script).toContain("list.push({ key: 'following', label: 'Följer', value: follows.list.value.length, opens: true })")
    const stats = all(row).find(n => n.tag === 'dl')!
    const item = stats.children!.find(c => c.type === 1)!
    expect(bound(item, 'for')).toBe('s in stats')
  })

  it('numbers, no links (no follower lists)', () => {
    const stats = all(row).find(n => n.tag === 'dl')!
    expect(all(stats).some(n => ['a', 'NuxtLink'].includes(n.tag!))).toBe(false)
    // One button at most: your own "Följer", which opens your private "Du följer"
    const buttons = all(stats).filter(n => n.tag === 'button')
    expect(buttons.map(b => bound(b, 'if'))).toEqual(['s.opens'])
    expect(attr(buttons[0]!, 'aria-haspopup')).toBe('dialog')
  })
})

