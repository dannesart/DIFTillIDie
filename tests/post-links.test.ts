import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { AuthStore } from '../app/lib/auth'
import { COMMENT_LIMIT, createInteractions } from '../app/lib/interactions'
import { sectionLinks } from '../app/lib/sectionLinks'
import { commentFromHash, createSinglePost } from '../app/lib/singlePost'
import type { Row } from './support/fake-postgrest'
import { cmp, fakePostgrest } from './support/fake-postgrest'

/*
 * Links to one Snacket post (/snacket/inlagg/<id>) and one of its comments
 * (#comment-<id>), for any post, however old, and any comment, however far
 * down its thread. Real supabase-js requests against an in-memory PostgREST
 * with real-shaped rows.
 */

const LOTTA = '00000000-0000-4000-8000-00000000000a'
const KALLE = '00000000-0000-4000-8000-00000000000b'
const people: Record<string, Row> = {
  [LOTTA]: { id: LOTTA, display_name: 'Lotta från Gärdet', handle: 'lotta', avatar: 'halsduk' },
  [KALLE]: { id: KALLE, display_name: 'Kalle', handle: 'kalle', avatar: null },
}
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12) + minute * 60_000).toISOString().replace('Z', '+00:00')

function world() {
  // 80 posts: the one we link to is the oldest, far outside Snacket's newest 50
  const posts: Row[] = Array.from({ length: 80 }, (_, i) => ({ id: uuid('10000000', i + 1), author_id: i % 2 ? KALLE : LOTTA, body: `Inlägg ${i + 1}`, sport: null, story_id: null, story_ref: null, created_at: at(i * 60) }))
  const target = posts[0]!
  // 450 comments on it, some at the very same moment (the id breaks the tie), and a few on another post
  const comments: Row[] = Array.from({ length: 450 }, (_, i) => ({ id: uuid('20000000', i + 1), post_id: target.id, author_id: i % 3 ? KALLE : LOTTA, body: `Kommentar ${i + 1}`, created_at: at(10_000 + Math.floor(i / 2)) }))
  comments.push({ id: uuid('20000000', 999), post_id: posts[1]!.id, author_id: KALLE, body: 'På ett annat inlägg', created_at: at(20_000) })
  const db = fakePostgrest({
    posts: () => posts.map(p => ({ ...p, author: people[p.author_id as string] })),
    post_comments: () => comments.map(c => ({ ...c, author: people[c.author_id as string] })),
  })
  return { posts, comments, target, ...db }
}

describe('a post on a page of its own', () => {
  it('reads any post by its id, however old: one request, not Snacket’s newest 50', async () => {
    const w = world()
    const single = createSinglePost(w.client, w.target.id as string)
    await single.load()
    expect(single.status.value).toBe('ready')
    expect([single.post.value?.body, single.post.value?.author.handle]).toEqual(['Inlägg 1', 'lotta'])
    expect(w.requests).toHaveLength(1)
    expect(w.requests[0]!.params).toContainEqual(['id', `eq.${w.target.id}`])
  })

  it('a deleted or never-existing post: missing, said plainly', async () => {
    const w = world()
    const single = createSinglePost(w.client, uuid('10000000', 404))
    await single.load()
    expect([single.status.value, single.post.value]).toEqual(['missing', null])
  })

  it('an address that isn’t a post id is missing, without asking the database', async () => {
    const w = world()
    for (const bad of ['abc', '1 or 1=1', '10000000-0000-4000-8000', '']) {
      const single = createSinglePost(w.client, bad)
      await single.load()
      expect(single.status.value, bad).toBe('missing')
    }
    expect(w.requests).toHaveLength(0)
  })

  it('a failure says so and can be retried', async () => {
    let fail = true
    const posts = [{ id: uuid('10000000', 1), author_id: LOTTA, body: 'Hej', sport: null, story_id: null, story_ref: null, created_at: at(0), author: people[LOTTA] }]
    const { client } = fakePostgrest({ posts: () => posts }, { fail: () => (fail ? { code: 'XX000', message: 'boom' } : null) })
    const single = createSinglePost(client, posts[0]!.id)
    await single.load()
    expect(single.status.value).toBe('error')
    fail = false
    await single.load()
    expect(single.status.value).toBe('ready')
  })

  it('deleted here by its author: removed', async () => {
    const w = world()
    const single = createSinglePost(w.client, w.target.id as string)
    await single.load()
    single.removed()
    expect([single.status.value, single.post.value]).toEqual(['removed', null])
  })
})

describe('a link to a comment', () => {
  it('reads the comment id from #comment-<uuid> only', () => {
    const id = uuid('20000000', 7)
    expect(commentFromHash(`#comment-${id}`)).toBe(id)
    expect(commentFromHash(`#comment-${id.toUpperCase()}`)).toBe(id)
    for (const bad of ['', '#', '#post-x', '#comment-', '#comment-abc', `#comment-${id}x`]) expect(commentFromHash(bad), bad).toBeNull()
  })

  it('is checked against this post: present, gone, or on another post (never shown as if it were here)', async () => {
    const w = world()
    const single = createSinglePost(w.client, w.target.id as string)
    await single.checkComment(uuid('20000000', 333))
    expect(single.comment.value).toBe('present')
    await single.checkComment(uuid('20000000', 9999))
    expect(single.comment.value).toBe('missing')
    await single.checkComment(uuid('20000000', 999)) // exists, but on another post
    expect(single.comment.value).toBe('missing')
    await single.checkComment(null)
    expect(single.comment.value).toBe('none')
  })

  it('links point at the post page, and at the comment on it', () => {
    const l = sectionLinks('/')
    expect(l.postPage('p1')).toBe('/snacket/inlagg/p1')
    expect(l.postPage('p1', 'c1')).toBe('/snacket/inlagg/p1#comment-c1')
    // Snacket's own anchor link is unchanged
    expect(l.post('p1')).toBe('/snacket#post-p1')
  })
})

describe('a thread past COMMENT_LIMIT', () => {
  const auth = { userId: ref(null), status: ref('signed-out'), profileStatus: ref('idle'), profile: ref(null) } as unknown as AuthStore

  it('reads on a page at a time after the last comment, oldest first, complete and without repeats', async () => {
    const w = world()
    const ix = createInteractions(w.client, auth, null)
    const postId = w.target.id as string
    await ix.loadComments(postId)
    expect(ix.threads.value[postId]!.list).toHaveLength(COMMENT_LIMIT)
    expect(ix.threads.value[postId]!.more).toBe(true)
    expect(await ix.loadMoreComments(postId)).toBe(true)
    expect(await ix.loadMoreComments(postId)).toBe(true)
    const t = ix.threads.value[postId]!
    expect(t.more).toBe(false)
    const expected = w.comments.filter(c => c.post_id === postId).sort((a, b) => cmp(a.created_at as string, b.created_at as string) || cmp(a.id as string, b.id as string)).map(c => c.id)
    expect(t.list.map(c => c.id)).toEqual(expected)
    // Nothing further to read
    expect(await ix.loadMoreComments(postId)).toBe(false)
  })

  it('a comment beyond the first 200 can be reached', async () => {
    const w = world()
    const ix = createInteractions(w.client, auth, null)
    const postId = w.target.id as string
    const far = uuid('20000000', 431)
    await ix.loadComments(postId)
    expect(ix.threads.value[postId]!.list.some(c => c.id === far)).toBe(false)
    while (!ix.threads.value[postId]!.list.some(c => c.id === far) && ix.threads.value[postId]!.more) await ix.loadMoreComments(postId)
    expect(ix.threads.value[postId]!.list.some(c => c.id === far)).toBe(true)
  })

  it('a failed page keeps what’s shown, and can be tried again', async () => {
    const w = world()
    let failing = false
    const { client } = fakePostgrest({ post_comments: () => w.comments.map(c => ({ ...c, author: people[c.author_id as string] })) }, { fail: () => (failing ? { code: 'XX000', message: 'boom' } : null) })
    const ix = createInteractions(client, auth, null)
    const postId = w.target.id as string
    await ix.loadComments(postId)
    failing = true
    expect(await ix.loadMoreComments(postId)).toBe(false)
    expect([ix.threads.value[postId]!.list.length, ix.threads.value[postId]!.more, ix.threads.value[postId]!.loadingMore]).toEqual([COMMENT_LIMIT, true, false])
    failing = false
    expect(await ix.loadMoreComments(postId)).toBe(true)
    expect(ix.threads.value[postId]!.list).toHaveLength(2 * COMMENT_LIMIT)
  })
})

describe('the page and the thread, as written', () => {
  const view = readFileSync('app/shell/views/Inlagg.vue', 'utf8').replace(/\r\n/g, '\n')
  const thread = readFileSync('app/components/RealPostInteractions.vue', 'utf8').replace(/\r\n/g, '\n')

  it('is a shell route, cached like the other public shells', () => {
    expect(readFileSync('modules/app-shell.ts', 'utf8')).toContain("{ name: 'snacket-inlagg', path: 'snacket/inlagg/:postId()', file: view('Inlagg') }")
    expect(readFileSync('nuxt.config.ts', 'utf8')).toContain("'/snacket/inlagg/**': { isr: 300 }")
  })

  it('uses the one post card, and only points at a comment known to be on this post', () => {
    expect(view.match(/<PostCard\b/g)).toHaveLength(1)
    expect(view).toContain("const focus = computed(() => (comment.value === 'present' ? wanted.value : null))")
    for (const s of ['Inlägget finns inte.', 'Inlägget är borttaget.', 'Kommentaren finns inte längre. Den kan ha tagits bort.', 'Kunde inte hämta inlägget just nu.', 'Kunde inte visa kommentaren just nu.']) expect(view).toContain(s)
  })

  it('every comment has its anchor; the linked one is found page by page, scrolled to, focused and briefly highlighted', () => {
    expect(thread).toContain(':id="commentAnchor(c.id)"')
    expect(thread).toContain('await loadMoreComments(props.postId)')
    expect(thread).toContain("el?.scrollIntoView({ block: 'center' })")
    expect(thread).toContain('el?.focus({ preventScroll: true })')
    expect(thread).toContain('Visa fler kommentarer')
  })
})
