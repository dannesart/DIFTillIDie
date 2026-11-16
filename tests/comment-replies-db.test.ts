import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { applyMigrations, as, codeOf, createSupabaseLikeDb, realDataSnapshot, seedRealData } from './db/supabase-harness'

/*
 * Direct replies to comments (20261116120000_comment_replies.sql), against
 * the real migrations in PGlite. A reply is a real reference to a comment on
 * the same post; the thread stays flat and chronological.
 * Codes: 42501 permission denied, 23503 foreign key, 23514 check.
 */

const REPLIES = '20261116120000_comment_replies.sql'
const JARN = '44444444-4444-4444-8444-444444444444'
const MATTIAS = '55555555-5555-4555-8555-555555555555'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const NILS = '33333333-3333-4333-8333-333333333333'
const NOWHERE = '99999999-9999-4999-8999-999999999999'

let db: Db
let post: string
let otherPost: string

async function people(d: Db) {
  await d.exec(`insert into auth.users (id, email) values ('${JARN}', 'j@example.test'), ('${MATTIAS}', 'm@example.test'), ('${LOTTA}', 'l@example.test'), ('${NILS}', 'n@example.test')`)
  for (const [id, name, handle] of [[JARN, 'Järnmannen', 'jarnmannen'], [MATTIAS, 'Mattias', 'mattias'], [LOTTA, 'Lotta', 'lotta_g']] as const) {
    await as(d, 'authenticated', id, () => d.query('insert into public.profiles (id, display_name, handle) values ($1, $2, $3)', [id, name, handle]))
  }
  const publish = (body: string) => as(d, 'authenticated', JARN, async () =>
    (await d.query<{ id: string }>('select id from public.publish_post($1)', [body])).rows[0]!.id)
  return { post: await publish('Järnkaminen brinner!'), otherPost: await publish('Ett annat inlägg') }
}

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  ;({ post, otherPost } = await people(db))
})

interface Row { id: string, author_id: string, parent_comment_id: string | null, is_reply: boolean }
/** Comment (or reply, with `parent`) as whoever is signed in; returns the stored row. */
const comment = async (body: string, parent: string | null = null, postId = post) =>
  (await db.query<Row>('insert into public.post_comments (post_id, body, parent_comment_id) values ($1, $2, $3) returning id, author_id, parent_comment_id, is_reply', [postId, body, parent])).rows[0]!
const by = <T>(who: string, fn: () => Promise<T>) => as(db, 'authenticated', who, fn)
const row = async (id: string) =>
  (await db.query<Row>('select id, author_id, parent_comment_id, is_reply from public.post_comments where id = $1', [id])).rows[0]

describe('publishing', () => {
  it('an ordinary comment has no parent and is not a reply', async () => {
    const c = await by(MATTIAS, () => comment('Vilken kväll! 💙'))
    expect(c).toMatchObject({ author_id: MATTIAS, parent_comment_id: null, is_reply: false })
  })

  it('a reply to a comment on the same post, and a reply to that reply', async () => {
    const first = await by(MATTIAS, () => comment('Vilken kväll!'))
    const reply = await by(LOTTA, () => comment('Verkligen!', first.id))
    const replyToReply = await by(MATTIAS, () => comment('Eller hur, Lotta', reply.id))
    expect(reply).toMatchObject({ author_id: LOTTA, parent_comment_id: first.id, is_reply: true })
    expect(replyToReply).toMatchObject({ author_id: MATTIAS, parent_comment_id: reply.id, is_reply: true })
    // You may answer your own comment too
    expect(await by(MATTIAS, () => comment('Och en sak till', first.id))).toMatchObject({ parent_comment_id: first.id, is_reply: true })
  })

  it('the parent must exist, on the same post', async () => {
    const elsewhere = await by(MATTIAS, () => comment('På ett annat inlägg', null, otherPost))
    await by(LOTTA, async () => {
      expect(await codeOf(comment('Fel inlägg', elsewhere.id))).toBe('23503')
      expect(await codeOf(comment('Finns inte', NOWHERE))).toBe('23503')
    })
    expect((await db.query('select count(*)::int as n from public.post_comments')).rows).toEqual([{ n: 1 }])
  })

  it('a comment cannot answer itself, and no cycle can be formed, even by roles that choose ids', async () => {
    const a = '66666666-6666-4666-8666-666666666661'
    const b = '66666666-6666-4666-8666-666666666662'
    await as(db, 'service_role', null, async () => {
      expect(await codeOf(db.query(`insert into public.post_comments (id, post_id, author_id, body, parent_comment_id) values ($1, $2, $3, 'Själv', $1)`, [a, post, MATTIAS]))).toBe('23514')
      // Two rows answering each other in one statement: the second doesn't exist yet when the first is checked
      expect(await codeOf(db.query(`insert into public.post_comments (id, post_id, author_id, body, parent_comment_id) values ($1, $3, $4, 'A', $2), ($2, $3, $4, 'B', $1)`, [a, b, post, MATTIAS]))).toBe('23503')
    })
    expect((await db.query('select count(*)::int as n from public.post_comments')).rows).toEqual([{ n: 0 }])
    // The self-reference is also a declared constraint, not only the trigger's rule
    const checks = (await db.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.post_comments'::regclass and conname = 'post_comments_not_own_parent'`)).rows
    expect(checks[0]!.def).toBe('CHECK ((parent_comment_id <> id))')
  })

  it('is_reply is the database’s: whatever is sent, it follows from the parent', async () => {
    const first = await by(MATTIAS, () => comment('Först'))
    await as(db, 'service_role', null, async () => {
      const ins = (parent: string | null, isReply: boolean) => db.query<Row>(`insert into public.post_comments (post_id, author_id, body, parent_comment_id, is_reply) values ($1, $2, 'x', $3, $4) returning is_reply`, [post, LOTTA, parent, isReply])
      expect((await ins(null, true)).rows[0]!.is_reply).toBe(false)
      expect((await ins(first.id, false)).rows[0]!.is_reply).toBe(true)
    })
  })
})

describe('what a supporter can and cannot do', () => {
  it('cannot choose is_reply, the author, the id or the time', async () => {
    const first = await by(MATTIAS, () => comment('Först'))
    await by(LOTTA, async () => {
      for (const [col, val] of [['is_reply', 'true'], ['is_reply', 'false'], ['author_id', MATTIAS], ['id', '66666666-6666-4666-8666-666666666666'], ['created_at', '2000-01-01']]) {
        expect(await codeOf(db.query(`insert into public.post_comments (post_id, body, parent_comment_id, ${col}) values ($1, 'x', $2, $3)`, [post, first.id, val])), col).toBe('42501')
      }
    })
  })

  it('cannot move a reply, or unmark it, after publishing; not even its author', async () => {
    const first = await by(MATTIAS, () => comment('Först'))
    const second = await by(MATTIAS, () => comment('Andra'))
    const reply = await by(LOTTA, () => comment('Svar', first.id))
    for (const who of [LOTTA, MATTIAS, JARN]) {
      await by(who, async () => {
        expect(await codeOf(db.query('update public.post_comments set parent_comment_id = $1 where id = $2', [second.id, reply.id]))).toBe('42501')
        expect(await codeOf(db.query('update public.post_comments set parent_comment_id = null where id = $1', [reply.id]))).toBe('42501')
        expect(await codeOf(db.query('update public.post_comments set is_reply = false where id = $1', [reply.id]))).toBe('42501')
      })
    }
    // Nor can a role that may update: only the database clears a reference, when the parent is gone
    await as(db, 'service_role', null, async () => {
      expect(await codeOf(db.query('update public.post_comments set parent_comment_id = $1 where id = $2', [second.id, reply.id]))).toBe('23514')
      expect(await codeOf(db.query('update public.post_comments set parent_comment_id = null where id = $1', [reply.id]))).toBe('23514')
      expect(await codeOf(db.query('update public.post_comments set is_reply = false where id = $1', [reply.id]))).toBe('23514')
      expect(await codeOf(db.query('update public.post_comments set is_reply = true where id = $1', [first.id]))).toBe('23514')
      expect(await codeOf(db.query('update public.post_comments set parent_comment_id = $1 where id = $2', [first.id, second.id]))).toBe('23514')
    })
    expect(await row(reply.id)).toMatchObject({ parent_comment_id: first.id, is_reply: true })
  })

  it('anonymous visitors cannot reply; a supporter without a profile cannot either', async () => {
    const first = await by(MATTIAS, () => comment('Först'))
    await as(db, 'anon', null, async () => expect(await codeOf(comment('Anonym', first.id))).toBe('42501'))
    await by(NILS, async () => expect(await codeOf(comment('Utan profil', first.id))).toBe('42501'))
    // Everyone reads replies and what they answer
    await as(db, 'anon', null, async () => {
      expect((await db.query('select parent_comment_id, is_reply from public.post_comments where id = $1', [first.id])).rows).toEqual([{ parent_comment_id: null, is_reply: false }])
    })
  })

  it('only the author deletes a reply, as with any comment', async () => {
    const first = await by(MATTIAS, () => comment('Först'))
    const reply = await by(LOTTA, () => comment('Svar', first.id))
    for (const who of [MATTIAS, JARN]) await by(who, async () => expect((await db.query('delete from public.post_comments where id = $1', [reply.id])).affectedRows).toBe(0))
    await by(LOTTA, async () => expect((await db.query('delete from public.post_comments where id = $1', [reply.id])).affectedRows).toBe(1))
    expect(await row(first.id)).toBeDefined()
  })

  it('the grants: one more column to insert, still nothing to update', async () => {
    const cols = await db.query<{ privilege_type: string, column_name: string }>(`
      select privilege_type, column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'post_comments' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
      order by privilege_type, column_name`)
    expect(cols.rows).toEqual([
      { privilege_type: 'INSERT', column_name: 'body' },
      { privilege_type: 'INSERT', column_name: 'parent_comment_id' },
      { privilege_type: 'INSERT', column_name: 'post_id' },
    ])
    const anon = await db.query(`select privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'post_comments' and grantee = 'anon' and privilege_type <> 'SELECT'`)
    expect(anon.rows).toEqual([])
    const fn = await db.query<{ anon: boolean, authenticated: boolean }>(`select has_function_privilege('anon', 'public.post_comments_reply_guard()', 'execute') as anon, has_function_privilege('authenticated', 'public.post_comments_reply_guard()', 'execute') as authenticated`)
    expect(fn.rows).toEqual([{ anon: false, authenticated: false }])
  })
})

describe('deletion', () => {
  /** Mattias → Lotta answers → Mattias answers Lotta → Lotta answers that. */
  async function chain() {
    const a = await by(MATTIAS, () => comment('A'))
    const b = await by(LOTTA, () => comment('B', a.id))
    const c = await by(MATTIAS, () => comment('C', b.id))
    const d = await by(LOTTA, () => comment('D', c.id))
    return { a, b, c, d }
  }

  it('deleting a comment keeps its replies; they stay replies, to a comment that is gone; further replies keep their parents', async () => {
    const { a, b, c, d } = await chain()
    await by(MATTIAS, () => db.query('delete from public.post_comments where id = $1', [a.id]))
    expect(await row(a.id)).toBeUndefined()
    expect(await row(b.id)).toMatchObject({ parent_comment_id: null, is_reply: true })
    expect(await row(c.id)).toMatchObject({ parent_comment_id: b.id, is_reply: true })
    expect(await row(d.id)).toMatchObject({ parent_comment_id: c.id, is_reply: true })
  })

  it('deleting a reply in the middle keeps the replies to it, and what it answered', async () => {
    const { a, b, c, d } = await chain()
    await by(LOTTA, () => db.query('delete from public.post_comments where id = $1', [b.id]))
    expect(await row(a.id)).toMatchObject({ parent_comment_id: null, is_reply: false })
    expect(await row(c.id)).toMatchObject({ parent_comment_id: null, is_reply: true })
    expect(await row(d.id)).toMatchObject({ parent_comment_id: c.id, is_reply: true })
    // Never moved on to another comment: c doesn't now answer a
    expect((await db.query('select count(*)::int as n from public.post_comments where parent_comment_id = $1', [a.id])).rows).toEqual([{ n: 0 }])
  })

  it('a post with reply chains can be deleted, comments and all', async () => {
    const { a } = await chain()
    const b2 = await by(LOTTA, () => comment('Ett till svar på A', a.id))
    expect(b2.is_reply).toBe(true)
    const kept = await by(MATTIAS, () => comment('På det andra inlägget', null, otherPost))
    await by(JARN, async () => expect((await db.query('delete from public.posts where id = $1', [post])).affectedRows).toBe(1))
    expect((await db.query('select id from public.post_comments')).rows).toEqual([{ id: kept.id }])
  })

  it('a deleted account takes its comments and replies; others’ replies to them stay, as replies', async () => {
    const { a, b, c, d } = await chain()
    const lottasOwn = await by(LOTTA, () => comment('Lottas egen'))
    const mattiasReply = await by(MATTIAS, () => comment('Mattias svarar Lotta', lottasOwn.id))
    await db.exec(`delete from auth.users where id = '${MATTIAS}'`)
    for (const gone of [a, c, mattiasReply]) expect(await row(gone.id)).toBeUndefined()
    expect(await row(b.id)).toMatchObject({ parent_comment_id: null, is_reply: true })
    expect(await row(d.id)).toMatchObject({ parent_comment_id: null, is_reply: true })
    expect(await row(lottasOwn.id)).toMatchObject({ parent_comment_id: null, is_reply: false })
  })

  it('a reply to a comment deleted just before is refused; a comment deleted just after its reply leaves the reply', async () => {
    // The two orders of a race between deleting the parent and publishing a
    // reply. (The truly concurrent version runs against a real stack:
    // tests/comment-replies-stack.test.ts.)
    const first = await by(MATTIAS, () => comment('Först'))
    await by(MATTIAS, () => db.query('delete from public.post_comments where id = $1', [first.id]))
    await by(LOTTA, async () => expect(await codeOf(comment('För sent', first.id))).toBe('23503'))

    const second = await by(MATTIAS, () => comment('Andra'))
    await db.exec('begin')
    const reply = await by(LOTTA, () => comment('Hann före', second.id))
    await by(MATTIAS, () => db.query('delete from public.post_comments where id = $1', [second.id]))
    await db.exec('commit')
    expect(await row(reply.id)).toMatchObject({ parent_comment_id: null, is_reply: true })
  })
})

describe('the thread as it was', () => {
  it('existing comments stay valid, ordinary and answerable', async () => {
    const old = await createSupabaseLikeDb({ stopBefore: REPLIES })
    const ids = await people(old)
    const before = await as(old, 'authenticated', MATTIAS, async () =>
      (await old.query<{ id: string }>(`insert into public.post_comments (post_id, body) values ($1, 'Från förr') returning id`, [ids.post])).rows[0]!.id)
    await applyMigrations(old, { from: REPLIES })
    expect((await old.query('select body, parent_comment_id, is_reply from public.post_comments')).rows).toEqual([{ body: 'Från förr', parent_comment_id: null, is_reply: false }])
    const r = await as(old, 'authenticated', LOTTA, async () =>
      (await old.query<Row>('insert into public.post_comments (post_id, body, parent_comment_id) values ($1, $2, $3) returning parent_comment_id, is_reply', [ids.post, 'Svar på det gamla', before])).rows[0]!)
    expect(r).toEqual({ parent_comment_id: before, is_reply: true })
    // A comment without a parent is still published exactly as before (post_id and body only)
    await as(old, 'authenticated', LOTTA, () => old.query(`insert into public.post_comments (post_id, body) values ($1, 'Som vanligt')`, [ids.post]))
    await old.close()
  })

  it('replies count as comments, and the thread stays chronological, a page at a time', async () => {
    const a = await by(MATTIAS, () => comment('1'))
    const b = await by(LOTTA, () => comment('2'))
    await by(LOTTA, () => comment('3 svarar 1', a.id))
    await by(MATTIAS, () => comment('4'))
    await by(MATTIAS, () => comment('5 svarar 2', b.id))
    await by(JARN, () => comment('6'))
    // A minute apart, in publishing order (so the test can't depend on the clock's resolution)
    await db.exec(`update public.post_comments set created_at = timestamptz '2026-11-01 12:00+00' + make_interval(mins => split_part(body, ' ', 1)::int)`)
    const stats = (await as(db, 'anon', null, () => db.query<{ comments: number }>('select comments from public.post_stats($1)', [[post]]))).rows
    expect(stats).toEqual([{ comments: 6 }])
    // The client's keyset paging (created_at, then id), two at a time
    const page = (after?: { created_at: string, id: string }) => as(db, 'anon', null, async () => (await db.query<{ id: string, body: string, created_at: string, parent_comment_id: string | null }>(
      `select id, body, created_at::text, parent_comment_id from public.post_comments where post_id = $1
       and ($2::timestamptz is null or created_at > $2::timestamptz or (created_at = $2::timestamptz and id > $3::uuid))
       order by created_at, id limit 2`, [post, after?.created_at ?? null, after?.id ?? null])).rows)
    const seen: string[] = []
    let after: { created_at: string, id: string } | undefined
    for (let p = await page(); p.length; p = await page(after)) {
      seen.push(...p.map(r => r.body))
      after = p.at(-1)
    }
    expect(seen).toEqual(['1', '2', '3 svarar 1', '4', '5 svarar 2', '6'])
    // Nothing about a reply changes its place: not its parent, not who it answers
    expect((await db.query('select count(*)::int as n from public.post_comments where is_reply')).rows).toEqual([{ n: 2 }])
  })
})

describe('the pgTAP suite for the real database (supabase/tests)', () => {
  it.each([['an empty database', false], ['a database with real supporters, posts and comments', true]])('runs green against %s', async (_label, withRealData) => {
    await db.exec('delete from auth.users')
    if (withRealData) {
      await seedRealData(db)
      await db.exec(`
        insert into public.post_comments (post_id, author_id, body) select id, author_id, 'Riktig kommentar' from public.posts;
        insert into public.post_comments (post_id, author_id, body, parent_comment_id) select post_id, author_id, 'Riktigt svar', id from public.post_comments;`)
    }
    const before = await realDataSnapshot(db)
    const relations = (await db.query('select body, parent_comment_id is not null as has_parent, is_reply from public.post_comments order by body')).rows
    const { lines, planned } = await runPgTapFile(db, 'comment_replies_rls.test.sql')
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(db)).toEqual(before)
    expect((await db.query('select body, parent_comment_id is not null as has_parent, is_reply from public.post_comments order by body')).rows).toEqual(relations)
  })
})
