import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'
import { ref } from 'vue'
import type { AuthStore } from '../app/lib/auth'
import { COMMENT_LIMIT, PARENT_GONE_MESSAGE, POST_GONE_MESSAGE, createInteractions } from '../app/lib/interactions'
import type { FakeRequest, Row } from './support/fake-postgrest'
import { fakePostgrest } from './support/fake-postgrest'

/*
 * Direct replies to comments, in the app: what a reply answers comes from the
 * stored parent (parent_comment_id), never from an @mention; the thread stays
 * flat and chronological; the database decides what's allowed
 * (20261116120000_comment_replies.sql, tests/comment-replies-db.test.ts).
 */

const ME = '00000000-0000-4000-8000-000000000001'
const LOTTA = '00000000-0000-4000-8000-000000000002'
const POST = '10000000-0000-4000-8000-000000000001'
const mattias = { id: ME, display_name: 'Mattias', handle: 'mattias', avatar: null }
const lotta = { id: LOTTA, display_name: 'Lotta', handle: 'lotta_g', avatar: null }
const auth = { userId: ref(ME), status: ref('signed-in'), profileStatus: ref('ready'), profile: ref(null) } as unknown as AuthStore
const iso = (i: number) => new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString().replace('Z', '+00:00')
const cid = (i: number) => `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`

function row(i: number, author: typeof mattias, body: string, parent: number | null = null, isReply = parent !== null): Row {
  return { id: cid(i), post_id: POST, author_id: author.id, body, created_at: iso(i), parent_comment_id: parent === null ? null : cid(parent), is_reply: isReply, author }
}

function setup(rows: Row[], opts: { fail?: (req: FakeRequest) => unknown, posts?: Row[] } = {}) {
  const db = fakePostgrest({ post_comments: () => rows, posts: () => opts.posts ?? [{ id: POST }] }, {
    fail: (_t, req) => opts.fail?.(req),
    insert: (_t, v) => {
      const stored = { id: cid(9000 + rows.length), post_id: v.post_id, author_id: ME, body: v.body, created_at: iso(100_000 + rows.length), parent_comment_id: v.parent_comment_id ?? null, is_reply: !!v.parent_comment_id, author: mattias }
      rows.push(stored)
      return stored
    },
  })
  return { ...db, ix: createInteractions(db.client, auth, null) }
}
const lookups = (requests: FakeRequest[]) => requests.filter(r => r.method === 'GET' && r.params.some(([k, v]) => k === 'id' && v.startsWith('in.')))

describe('reading replies', () => {
  it('ordinary comments stay ordinary; a reply, and a reply to a reply, say what they answer', async () => {
    const { ix, requests } = setup([
      row(1, mattias, 'Vilken kväll!'),
      row(2, lotta, 'Verkligen!', 1),
      row(3, mattias, 'Eller hur', 2),
      // An @mention is only text: it doesn't make a reply
      row(4, mattias, '@lotta_g såg du målet?'),
    ])
    await ix.loadComments(POST)
    const list = ix.threads.value[POST]!.list
    expect(list.map(c => [c.body, c.isReply, c.replyTo])).toEqual([
      ['Vilken kväll!', false, null],
      ['Verkligen!', true, { id: cid(1), handle: 'mattias' }],
      ['Eller hur', true, { id: cid(2), handle: 'lotta_g' }],
      ['@lotta_g såg du målet?', false, null],
    ])
    // The parents were among the comments read: no extra request
    expect(lookups(requests)).toEqual([])
  })

  it('the handle is the answered author’s current one', async () => {
    const renamed = { ...mattias, handle: 'mattias_ny' }
    const { ix } = setup([row(1, renamed, 'Hej'), row(2, lotta, 'Hej själv', 1)])
    await ix.loadComments(POST)
    expect(ix.threads.value[POST]!.list[1]!.replyTo).toEqual({ id: cid(1), handle: 'mattias_ny' })
  })

  it('a reply to a deleted comment says so, and names no one', async () => {
    const { ix } = setup([row(2, lotta, 'Svarade på något som är borta', null, true)])
    await ix.loadComments(POST)
    const [c] = ix.threads.value[POST]!.list
    expect(c).toMatchObject({ isReply: true, replyTo: null })
  })

  it('a parent not among the comments read is read by id; gone → deleted; unreadable → no handle', async () => {
    // Gone between the reply being read and its parent being looked up
    const stray = setup([row(2, lotta, 'Svar på något som just togs bort', 1)])
    await stray.ix.loadComments(POST)
    expect(stray.ix.threads.value[POST]!.list[0]).toMatchObject({ isReply: true, replyTo: null })
    expect(lookups(stray.requests)).toHaveLength(1)

    // Couldn't be read just now: still a reply to it, without a handle
    const failing = setup([row(2, lotta, 'Svar', 1)], { fail: req => (lookups([req]).length ? { code: '500', message: 'boom' } : null) })
    await failing.ix.loadComments(POST)
    expect(failing.ix.threads.value[POST]!.list[0]!.replyTo).toEqual({ id: cid(1), handle: null })
  })

  it('pages stay chronological; a reply on a later page knows its parent from an earlier one, without asking again', async () => {
    const rows = Array.from({ length: COMMENT_LIMIT + 50 }, (_, i) => row(i + 1, i % 2 ? lotta : mattias, `K${i + 1}`))
    rows[229] = row(230, lotta, 'Sent svar på K5', 5)
    const { ix, requests } = setup(rows)
    await ix.loadComments(POST)
    while (ix.threads.value[POST]!.more) await ix.loadMoreComments(POST)
    const list = ix.threads.value[POST]!.list
    expect(list.map(c => c.id)).toEqual(rows.map(r => r.id))
    expect(list[229]!.replyTo).toEqual({ id: cid(5), handle: 'mattias' })
    expect(lookups(requests)).toEqual([])
  })
})

describe('publishing a reply', () => {
  it('a reply sends its parent; an ordinary comment sends exactly what it always has', async () => {
    const { ix, requests } = setup([row(1, lotta, 'Först')])
    await ix.loadComments(POST)
    const plain = await ix.addComment(POST, 'Vanlig kommentar')
    const reply = await ix.addComment(POST, 'Svar till Lotta', cid(1))
    const posts = requests.filter(r => r.method === 'POST').map(r => r.body)
    expect(posts).toEqual([{ post_id: POST, body: 'Vanlig kommentar' }, { post_id: POST, body: 'Svar till Lotta', parent_comment_id: cid(1) }])
    expect(plain.ok && reply.ok).toBe(true)
    const list = ix.threads.value[POST]!.list
    expect(list.map(c => [c.body, c.replyTo?.handle ?? null])).toEqual([['Först', null], ['Vanlig kommentar', null], ['Svar till Lotta', 'lotta_g']])
  })

  it('you can answer your own comment, and a reply', async () => {
    const { ix } = setup([row(1, mattias, 'Min'), row(2, lotta, 'Svar', 1)])
    await ix.loadComments(POST)
    expect((await ix.addComment(POST, 'Till mig själv', cid(1))).ok).toBe(true)
    expect((await ix.addComment(POST, 'Till Lottas svar', cid(2))).ok).toBe(true)
    expect(ix.threads.value[POST]!.list.slice(-2).map(c => c.replyTo)).toEqual([{ id: cid(1), handle: 'mattias' }, { id: cid(2), handle: 'lotta_g' }])
  })

  it('a reply to a comment not loaded here still learns its handle (read by id)', async () => {
    const { ix, requests } = setup([row(1, lotta, 'Först')])
    const r = await ix.addComment(POST, 'Svar', cid(1))
    expect(r.ok).toBe(true)
    expect(lookups(requests)).toHaveLength(1)
    expect(ix.threads.value[POST]!.list.at(-1)!.replyTo).toEqual({ id: cid(1), handle: 'lotta_g' })
  })

  const refusing = (error: Row, posts?: Row[]) => {
    const s = setup([row(1, lotta, 'Först')], { posts, fail: req => (req.method === 'POST' ? error : null) })
    return s
  }

  it.each([
    ['the reply guard (deleted, or another post’s comment)', { code: '23503', message: 'the comment being answered does not exist on this post' }],
    ['the foreign key (deleted while publishing)', { code: '23503', message: 'insert or update on table "post_comments" violates foreign key constraint "post_comments_parent_fkey"', details: 'Key (parent_comment_id, post_id)=(…) is not present in table "post_comments".' }],
  ])('the answered comment is gone (%s): said so; nothing added; never re-sent as an ordinary comment', async (_label, error) => {
    const { ix, requests } = refusing(error)
    await ix.loadComments(POST)
    const r = await ix.addComment(POST, 'Mitt svar', cid(1))
    expect(r).toEqual({ ok: false, message: PARENT_GONE_MESSAGE })
    expect(requests.filter(q => q.method === 'POST')).toHaveLength(1)
    expect(ix.threads.value[POST]!.list).toHaveLength(1)
    expect(ix.stats.value[POST]).toBeUndefined()
  })

  it('the answered comment went with its post: says the post is gone', async () => {
    const { ix } = refusing({ code: '23503', message: 'the comment being answered does not exist on this post' }, [])
    expect(await ix.addComment(POST, 'Mitt svar', cid(1))).toEqual({ ok: false, message: POST_GONE_MESSAGE })
  })

  it('an ordinary comment on a deleted post, and other failures, keep their own messages', async () => {
    const gone = refusing({ code: '23503', message: 'insert or update on table "post_comments" violates foreign key constraint "post_comments_post_id_fkey"' })
    expect(await gone.ix.addComment(POST, 'Hej')).toEqual({ ok: false, message: POST_GONE_MESSAGE })
    const denied = refusing({ code: '42501', message: 'new row violates row-level security policy' })
    const r = await denied.ix.addComment(POST, 'Hej', cid(1))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).not.toBe(PARENT_GONE_MESSAGE)
    expect(!r.ok && r.message).toMatch(/kommentera/)
  })

  it('deleting a comment you answered leaves the replies, now replies to a deleted comment', async () => {
    const { ix } = setup([row(1, mattias, 'Min'), row(2, lotta, 'Svar', 1), row(3, mattias, 'Svar på svaret', 2)])
    // Deleting: the fake answers a DELETE like a read, with the matching row
    await ix.loadComments(POST)
    expect((await ix.removeComment(POST, cid(1))).ok).toBe(true)
    expect(ix.threads.value[POST]!.list.map(c => [c.body, c.isReply, c.replyTo?.id ?? null])).toEqual([['Svar', true, null], ['Svar på svaret', true, cid(2)]])
  })
})

/* ── The page: read from the component ─────────────────────────────────── */
interface Prop { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string } }
interface Node { type: number, tag?: string, props?: Prop[], children?: Node[], content?: string | { content: string } }
const FILE = 'app/components/RealPostInteractions.vue'
const src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')
const ast = parse(src).descriptor.template!.ast as unknown as Node
const all = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(all)]
const bound = (n: Node, arg: string) => n.props?.find(p => p.type === 7 && p.arg?.content === arg)?.exp?.content
const cond = (n: Node) => n.props?.find(p => p.type === 7 && (p.name === 'if' || p.name === 'else-if'))?.exp?.content
const text = (n: Node): string => n.type === 2 ? (n.content as string) : n.type === 5 ? (n.content as { content: string }).content : (n.children ?? []).map(text).join('')
const conversation = all(ast).find(n => n.tag === 'section' && cond(n) === 'conversation')!
const comment = all(conversation).find(n => n.props?.some(p => p.name === 'for' && p.exp?.content === 'c in thread.list'))!

describe('on the post page', () => {
  it('every comment has Svara, for everyone; signed out or without a läktarnamn it opens the usual way in', () => {
    const svara = all(comment).find(n => n.tag === 'button' && text(n).trim() === 'Svara')!
    expect(bound(svara, 'onClick') ?? svara.props?.find(p => p.arg?.content === 'click')?.exp?.content).toBe('reply(c)')
    expect(cond(svara)).toBeUndefined()
    expect(bound(svara, 'aria-label')).toBe('`Svara @${c.author.handle}`')
    expect(src).toContain('if (!canInteract.value) return void (accountOpen.value = true)')
  })

  it('choosing a comment shows it above the same comment box, keeps your text, and brings the box into view', () => {
    const box = all(conversation).find(n => n.tag === 'div' && cond(n) === 'canInteract')!
    const order = all(box)
    const context = order.findIndex(n => cond(n) === 'replyTo')
    const form = order.findIndex(n => n.tag === 'form')
    expect(context).toBeGreaterThan(-1)
    expect(context).toBeLessThan(form)
    expect(text(order[context]!)).toMatch(/Svarar\s+@replyTo\.handle\s+·\s+Avbryt/)
    // Still one form, one input
    expect(all(conversation).filter(n => n.tag === 'form')).toHaveLength(1)
    const fn = src.slice(src.indexOf('async function reply('), src.indexOf('function cancelReply'))
    expect(fn).toContain('replyTo.value = { id: c.id, handle: c.author.handle }')
    expect(fn).toContain('composerInput.value?.scrollIntoView(')
    expect(fn).toContain('composerInput.value?.focus(')
    expect(fn).not.toContain('draft.value')
    expect(src.slice(src.indexOf('function cancelReply'), src.indexOf('function cancelReply') + 200)).not.toContain('draft.value')
  })

  it('publishing sends what you answer; success clears text and target, failure keeps both', () => {
    expect(src).toContain('const r = await addComment(props.postId, draft.value, replyTo.value?.id)\n  if (!r.ok) return void (sendError.value = r.message) // the text, and what it answers, stay\n  draft.value = \'\'\n  replyTo.value = null')
  })

  it('a reply links to what it answers; a reply to a deleted comment says so, unlinked', () => {
    const line = all(comment).find(n => cond(n) === 'c.isReply')!
    const link = all(line).find(n => n.tag === 'NuxtLink')!
    expect(cond(link)).toBe('c.replyTo')
    expect(bound(link, 'to')).toBe('links.postPage(postId, c.replyTo.id)')
    expect(text(link).replace(/\s+/g, ' ').trim()).toBe('↳ Svar till c.replyTo.handle ? `@${c.replyTo.handle}` : \'en kommentar\'')
    expect(link.props?.find(p => p.arg?.content === 'click')?.exp?.content).toBe('toComment(c.replyTo.id)')
    expect(text(line)).toContain('Svar till en borttagen kommentar')
  })

  it('the same comment link clicked again brings the comment back into view', () => {
    const fn = src.slice(src.indexOf('function toComment('), src.indexOf('function toComment(') + 400)
    expect(fn).toContain("if (route.hash.toLowerCase() !== `#${commentAnchor(id)}`.toLowerCase()) return")
    expect(fn).toContain('if (loaded(id)) void show(id)')
    // A comment's own time link does the same
    const time = all(comment).find(n => n.tag === 'NuxtLink' && bound(n, 'to') === 'links.postPage(postId, c.id)')!
    expect(time.props?.find(p => p.arg?.content === 'click')?.exp?.content).toBe('toComment(c.id)')
    // A link within the page to a comment already shown keeps what's loaded
    expect(src).toContain('if (fresh || !loaded(id)) {\n    await loadComments(props.postId)')
  })

  it('flat: every comment at the same indentation, whatever it answers; no nested threads', () => {
    for (const attr of ['class']) {
      expect(bound(comment, attr) ?? '').not.toMatch(/isReply|replyTo/)
    }
    // Inside a comment the only loop is over its own text, never over other comments
    const loops = all(comment).slice(1).flatMap(n => n.props?.filter(p => p.name === 'for').map(p => p.exp?.content) ?? [])
    expect(loops).toEqual(['(t, i) in tokenize(c.body)'])
    expect(src).not.toMatch(/ml-\d+[^"]*isReply|isReply[^"]*ml-\d+/)
  })

  it('replies live only on the post page', () => {
    for (const n of all(ast).filter(x => x.tag === 'button' && text(x).trim() === 'Svara')) expect(all(conversation)).toContain(n)
  })
})
