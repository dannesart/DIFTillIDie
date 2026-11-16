import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

/*
 * The post's own page (/snacket/inlagg/<id>) is the home of its conversation:
 * there its comments are always shown; everywhere else, its comment count,
 * its time and (on Hem) its text lead there. Read from the templates.
 */
interface Prop { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }
interface Node { type: number, tag?: string, props?: Prop[], children?: Node[], content?: string | { content: string } }
const src = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const ast = (f: string) => parse(src(f)).descriptor.template!.ast as unknown as Node
const all = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(all)]
const bound = (n: Node, arg: string) => n.props?.find(p => p.type === 7 && p.arg?.content === arg)?.exp?.content
const cond = (n: Node) => n.props?.find(p => p.type === 7 && (p.name === 'if' || p.name === 'else-if'))?.exp?.content
const has = (n: Node, name: string) => !!n.props?.some(p => p.name === name || p.arg?.content === name)
/** Text and {{ interpolations }} (as their expression), as written. */
const text = (n: Node): string => {
  if (n.type === 2) return (n.content as string) ?? ''
  if (n.type === 5) return (n.content as { content: string }).content
  return (n.children ?? []).map(text).join('')
}

describe('Hem: På läktaren nu', () => {
  const hem = ast('app/shell/views/Hem.vue')
  const item = all(hem).find(n => n.tag === 'li' && bound(n, 'key') === 'post.id')!

  it('the post text and its time open that post', () => {
    const links = all(item).filter(n => n.tag === 'NuxtLink')
    const toPost = links.filter(l => bound(l, 'to') === 'links.postPage(post.id)')
    expect(toPost).toHaveLength(2)
    expect(toPost.some(l => text(l).includes('post.body'))).toBe(true)
    expect(toPost.some(l => all(l).some(n => n.tag === 'TimeAgo'))).toBe(true)
  })

  it('the author still leads to their läktarplats, and nothing in a post leads to /snacket any more', () => {
    const links = all(item).filter(n => n.tag === 'NuxtLink')
    expect(links.filter(l => bound(l, 'to') === 'links.supporter(post.author.handle)')).toHaveLength(2)
    expect(links.some(l => bound(l, 'to') === "links.view('snacket')")).toBe(false)
  })

  it('"Till Snacket →" still opens Snacket', () => {
    const till = all(hem).find(n => n.tag === 'NuxtLink' && text(n).includes('Till Snacket'))!
    expect(bound(till, 'to')).toBe("links.view('snacket')")
  })
})

describe('the comments', () => {
  const thread = ast('app/components/RealPostInteractions.vue')
  const script = src('app/components/RealPostInteractions.vue')

  it('are shown only on the post page, and loaded there at once', () => {
    const section = all(thread).find(n => n.tag === 'section' && cond(n) === 'conversation')!
    expect(section).toBeDefined()
    // The thread, the comment box and the sign-in invitation all live inside it
    expect(all(section).some(n => n.tag === 'form')).toBe(true)
    expect(text(section)).toContain('för att kommentera.')
    expect(script).toMatch(/onMounted\(\(\) => \{\n {2}if \(!props\.conversation\) return\n {2}if \(props\.focusComment\) void focus\(props\.focusComment\)\n {2}else void loadComments\(props\.postId\)/)
  })

  it('the comment box (or the way in) comes first, then the comments, oldest first, then "Visa fler"', () => {
    const section = all(thread).find(n => n.tag === 'section' && cond(n) === 'conversation')!
    const order = all(section)
    const at = (find: (n: Node) => boolean) => order.findIndex(find)
    const form = at(n => n.tag === 'form')
    const needsProfile = at(n => cond(n) === "identity.kind === 'needs-profile'")
    const guest = at(n => cond(n) === "identity.kind === 'guest'")
    const sendError = at(n => cond(n) === 'sendError')
    const comments = at(n => n.props?.some(p => p.name === 'for' && p.exp?.content === 'c in thread.list') ?? false)
    const more = at(n => n.tag === 'button' && cond(n) === 'thread.more')
    const loading = at(n => cond(n) === "!thread || thread.status === 'loading'")
    for (const [name, i] of Object.entries({ form, needsProfile, guest, sendError, comments, more, loading })) expect(i, name).toBeGreaterThan(-1)
    expect(Math.max(form, needsProfile, guest, sendError)).toBeLessThan(Math.min(loading, comments))
    expect(comments).toBeLessThan(more)
    // Still one form, the same submit
    expect(order.filter(n => n.tag === 'form')).toHaveLength(1)
    expect(order[form]!.props?.find(p => p.arg?.content === 'submit')?.exp?.content).toBe('send')
  })

  it('elsewhere, the count is a link to the post page; the reactions stay where the post is', () => {
    const link = all(thread).find(n => n.tag === 'NuxtLink' && bound(n, 'to') === 'links.postPage(postId)')!
    expect(has(link, 'else')).toBe(true)
    // Reactions are buttons, with or without the conversation
    const reactions = all(thread).find(n => n.tag === 'button' && bound(n, 'aria-pressed'))!
    expect(cond(reactions)).toBeUndefined()
  })

  it('the post page asks for the conversation; Snacket and läktarplatser don’t', () => {
    const cards = (f: string) => all(ast(f)).filter(n => n.tag === 'PostCard')
    expect(cards('app/shell/views/Inlagg.vue').every(c => has(c, 'conversation'))).toBe(true)
    expect(cards('app/components/SnacketSection.vue').some(c => has(c, 'conversation'))).toBe(false)
    expect(cards('app/components/SupporterPlace.vue').some(c => has(c, 'conversation'))).toBe(false)
    expect(src('app/components/PostCard.vue')).toContain(':conversation="conversation"')
  })

  it('the post card itself is not one big link', () => {
    const card = ast('app/components/PostCard.vue')
    const article = all(card).find(n => n.tag === 'article')!
    expect(all(card).filter(n => n.tag === 'NuxtLink').every(l => l !== article && !all(l).includes(article))).toBe(true)
    expect(bound(article, 'onClick') ?? bound(article, 'click')).toBeUndefined()
  })
})
