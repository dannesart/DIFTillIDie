import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * Replies to comments against a real, disposable LOCAL Supabase stack (CI:
 * .github/workflows/database.yml): what PGlite, with its single connection,
 * can't show — publishing a reply and deleting the comment it answers at the
 * same time, over the real API.
 *
 * It creates users, posts and comments, so it refuses to run unless
 * COMMENT_REPLIES_STACK=local and the API and database are on localhost.
 * Never point it at the hosted project.
 */

const env = process.env
const enabled = env.COMMENT_REPLIES_STACK === 'local'
const apiUrl = env.API_URL ?? ''
const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY ?? ''
const serviceKey = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY ?? ''
const dbUrl = env.DB_URL ?? ''
const local = (u: string) => /^(http|postgres(ql)?):\/\/[^@/]*@?(127\.0\.0\.1|localhost)[:/]/.test(u)
/** supabase-js sends nothing until awaited: start a request now. */
const start = <T>(p: PromiseLike<T>) => Promise.resolve(p)

describe.skipIf(!enabled)('replies on a local Supabase stack', () => {
  let sql: postgres.Sql
  let admin: SupabaseClient
  const run = Date.now().toString(36)
  const users: string[] = []

  beforeAll(() => {
    if (!local(apiUrl) || !local(dbUrl)) throw new Error('Refusing to run: API_URL and DB_URL must point at a local stack (127.0.0.1/localhost).')
    sql = postgres(dbUrl, { max: 4, onnotice: () => {} })
    admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  })
  afterAll(async () => {
    for (const id of users) await admin?.auth.admin.deleteUser(id)
    await sql?.end()
  })

  /** A signed-in supporter with a profile. */
  async function supporter(name: string) {
    const email = `replies-${name}-${run}@example.test`
    const password = `pw-${run}-${name}-Aa1!`
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) throw created.error
    users.push(created.data.user!.id)
    const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedIn = await client.auth.signInWithPassword({ email, password })
    if (signedIn.error) throw signedIn.error
    const id = created.data.user!.id
    const profile = await client.from('profiles').insert({ id, display_name: name, handle: `rp_${name}_${run}`.slice(0, 20) })
    if (profile.error) throw profile.error
    return { id, client }
  }

  async function postWithComment() {
    const author = await supporter(`a${users.length}`)
    const published = await author.client.rpc('publish_post', { p_body: `Svarstest ${run}` })
    if (published.error) throw published.error
    const post = (published.data as { id: string }[] | { id: string })
    const postId = Array.isArray(post) ? post[0]!.id : post.id
    const c = await author.client.from('post_comments').insert({ post_id: postId, body: 'Föräldern' }).select('id').single()
    if (c.error) throw c.error
    return { author, postId, parentId: (c.data as { id: string }).id }
  }

  /** Wait until some session is provably blocked on a lock while touching post_comments. */
  async function blocked() {
    for (let i = 0; i < 100; i++) {
      const [w] = await sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%post_comments%'`
      if (w!.n > 0) return true
      await new Promise(r => setTimeout(r, 50))
    }
    return false
  }

  it('a reply sent while its parent is being deleted waits, then is refused (23503); nothing points at the deleted comment', async () => {
    const { postId, parentId } = await postWithComment()
    const replier = await supporter(`r${users.length}`)
    let pending: Promise<{ error: { code?: string } | null }> | undefined
    let waited = false
    await sql.begin(async (tx) => {
      // The deletion holds the parent row until this transaction commits.
      await tx`delete from public.post_comments where id = ${parentId}`
      pending = start(replier.client.from('post_comments').insert({ post_id: postId, body: 'För sent', parent_comment_id: parentId }))
      waited = await blocked()
    })
    expect(waited).toBe(true)
    expect((await pending!).error?.code).toBe('23503')
    expect(await sql`select id from public.post_comments where post_id = ${postId}`).toEqual([])
  })

  it('a parent deleted while a reply to it is being published waits; the reply stays, a reply to a deleted comment', async () => {
    const { author, postId, parentId } = await postWithComment()
    const replier = await supporter(`r${users.length}`)
    let pending: Promise<{ error: unknown, data: unknown }> | undefined
    let waited = false
    let replyId = ''
    await sql.begin(async (tx) => {
      // The reply, as its author would publish it, holds a key-share lock on the parent until commit.
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: replier.id, role: 'authenticated' })}, true)`
      await tx`set local role authenticated`
      ;[{ id: replyId }] = await tx`insert into public.post_comments (post_id, body, parent_comment_id) values (${postId}, 'Hann före', ${parentId}) returning id` as unknown as { id: string }[]
      pending = start(author.client.from('post_comments').delete().eq('id', parentId).select('id'))
      waited = await blocked()
    })
    expect(waited).toBe(true)
    const deleted = await pending!
    expect(deleted.error).toBeNull()
    expect(deleted.data).toEqual([{ id: parentId }])
    expect(await sql`select parent_comment_id, is_reply from public.post_comments where id = ${replyId}`).toEqual([{ parent_comment_id: null, is_reply: true }])
  })

  it('a burst of replies racing a deletion: each is either refused or kept as a reply; none points at a missing comment', async () => {
    const { author, postId, parentId } = await postWithComment()
    const repliers = await Promise.all([1, 2, 3, 4, 5, 6].map(i => supporter(`b${i}${users.length}`)))
    const replies = repliers.map(r => start(r.client.from('post_comments').insert({ post_id: postId, body: 'Svar i rusningen', parent_comment_id: parentId }).select('id').single()))
    const deletion = start(author.client.from('post_comments').delete().eq('id', parentId).select('id'))
    const results = await Promise.all(replies)
    expect((await deletion).error).toBeNull()
    for (const r of results) expect(r.error === null || (r.error as { code?: string }).code === '23503').toBe(true)
    const kept = results.filter(r => r.error === null).length
    const rows = await sql`select parent_comment_id, is_reply from public.post_comments where post_id = ${postId}`
    expect(rows).toHaveLength(kept)
    for (const row of rows) expect(row).toEqual({ parent_comment_id: null, is_reply: true })
    const [dangling] = await sql`select count(*)::int as n from public.post_comments c where c.parent_comment_id is not null and not exists (select 1 from public.post_comments p where p.id = c.parent_comment_id)`
    expect(dangling!.n).toBe(0)
  })
})
