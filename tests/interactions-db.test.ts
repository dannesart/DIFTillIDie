import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { as, codeOf, createSupabaseLikeDb, realDataSnapshot, seedRealData } from './db/supabase-harness'

/*
 * Database authorization for real reactions and comments, with four users:
 * Järnmannen publishes, Mattias and Lotta have profiles, Nils doesn't.
 * Runs the real migrations in PGlite (see supabase-harness). Codes: 42501
 * permission denied (grant or RLS), 23505 unique, 23514 check, 23503 FK.
 */

const JARN = '44444444-4444-4444-8444-444444444444'
const MATTIAS = '55555555-5555-4555-8555-555555555555'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const NILS = '33333333-3333-4333-8333-333333333333'

let db: Db
let post: string

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${JARN}', 'j@example.test'), ('${MATTIAS}', 'm@example.test'), ('${LOTTA}', 'l@example.test'), ('${NILS}', 'n@example.test')`)
  for (const [id, name, handle] of [[JARN, 'Järnmannen', 'jarnmannen'], [MATTIAS, 'Mattias', 'mattias'], [LOTTA, 'Lotta', 'lotta_g']] as const) {
    await as(db, 'authenticated', id, () => db.query('insert into public.profiles (id, display_name, handle) values ($1, $2, $3)', [id, name, handle]))
  }
  post = await as(db, 'authenticated', JARN, async () =>
    (await db.query<{ id: string }>(`insert into public.posts (body) values ('Järnkaminen brinner!') returning id`)).rows[0]!.id)
})

const react = (reaction: string | null, postId = post) =>
  db.query<{ previous: string | null }>('select public.set_post_reaction($1, $2) as previous', [postId, reaction])
const stats = async (ids = [post]) =>
  (await db.query<Record<string, number | string>>('select * from public.post_stats($1)', [ids])).rows
const comment = (body: string, postId = post) =>
  db.query<{ id: string, author_id: string }>('insert into public.post_comments (post_id, body) values ($1, $2) returning id, author_id', [postId, body])
const publicHandles = () => as(db, 'anon', null, async () =>
  (await db.query<{ handle: string }>('select handle from public.profiles order by handle')).rows.map(r => r.handle))

describe('reactions', () => {
  it('one reaction per supporter per post: add, switch, remove — returning the previous one', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      expect((await react('hjarta')).rows[0]!.previous).toBeNull()
      expect((await react('eld')).rows[0]!.previous).toBe('hjarta')
      expect((await react('eld')).rows[0]!.previous).toBe('eld') // same again: unchanged
      expect((await db.query('select reaction from public.post_reactions')).rows).toEqual([{ reaction: 'eld' }])
      expect((await react(null)).rows[0]!.previous).toBe('eld')
      expect((await db.query('select reaction from public.post_reactions')).rows).toEqual([])
    })
  })

  it('uniqueness is the database’s, not the client’s: a second row is refused', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      await db.query(`insert into public.post_reactions (post_id, reaction) values ($1, 'hjarta')`, [post])
      expect(await codeOf(db.query(`insert into public.post_reactions (post_id, reaction) values ($1, 'eld')`, [post]))).toBe('23505')
    })
  })

  it('anyone can read the totals, without signing in — and nothing about who reacted', async () => {
    await as(db, 'authenticated', MATTIAS, () => react('hjarta'))
    await as(db, 'authenticated', LOTTA, () => react('hjarta'))
    await as(db, 'authenticated', JARN, () => react('stjarna'))
    await as(db, 'anon', null, async () => {
      expect(await stats()).toEqual([{ post_id: post, hjarta: 2, eld: 0, stjarna: 1, tarar: 0, comments: 0 }])
      expect(await codeOf(db.query('select * from public.post_reactions'))).toBe('42501')
      expect(await codeOf(db.query('select count(*) from public.post_reactions'))).toBe('42501')
    })
    // Signed in, you see only your own reaction rows.
    await as(db, 'authenticated', MATTIAS, async () => {
      expect((await db.query('select user_id, reaction from public.post_reactions')).rows).toEqual([{ user_id: MATTIAS, reaction: 'hjarta' }])
    })
  })

  it('reacting does not make a supporter’s profile public', async () => {
    await as(db, 'authenticated', LOTTA, () => react('tarar'))
    expect(await publicHandles()).toEqual(['jarnmannen'])
  })

  it('anonymous visitors cannot react in any way', async () => {
    await as(db, 'anon', null, async () => {
      expect(await codeOf(react('hjarta'))).toBe('42501')
      expect(await codeOf(db.query(`insert into public.post_reactions (post_id, reaction) values ($1, 'hjarta')`, [post]))).toBe('42501')
      expect(await codeOf(db.query(`update public.post_reactions set reaction = 'eld'`))).toBe('42501')
      expect(await codeOf(db.query('delete from public.post_reactions'))).toBe('42501')
    })
  })

  it('signed in without a profile is not enough', async () => {
    await as(db, 'authenticated', NILS, async () => {
      expect(await codeOf(react('hjarta'))).toBe('42501')
    })
  })

  it('identity comes from the session: user_id can never be supplied', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      expect(await codeOf(db.query(`insert into public.post_reactions (post_id, user_id, reaction) values ($1, $2, 'hjarta')`, [post, LOTTA]))).toBe('42501')
      expect(await codeOf(db.query(`insert into public.post_reactions (post_id, user_id, reaction) values ($1, $2, 'hjarta')`, [post, MATTIAS]))).toBe('42501')
      await react('hjarta')
      expect(await codeOf(db.query('update public.post_reactions set user_id = $1', [LOTTA]))).toBe('42501')
    })
  })

  it('cannot change or remove someone else’s reaction, with or without WHERE', async () => {
    await as(db, 'authenticated', LOTTA, () => react('hjarta'))
    await as(db, 'authenticated', MATTIAS, async () => {
      expect((await db.query(`update public.post_reactions set reaction = 'tarar'`)).affectedRows).toBe(0)
      expect((await db.query(`update public.post_reactions set reaction = 'tarar' where user_id = $1`, [LOTTA])).affectedRows).toBe(0)
      expect((await db.query('delete from public.post_reactions')).affectedRows).toBe(0)
      expect((await react(null)).rows[0]!.previous).toBeNull() // only ever your own
    })
    expect((await db.query('select user_id, reaction from public.post_reactions')).rows).toEqual([{ user_id: LOTTA, reaction: 'hjarta' }])
  })

  it('rejects unknown reactions and unknown posts', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      expect(await codeOf(react('tumme'))).toBe('23514')
      expect(await codeOf(react('hjarta', '99999999-9999-4999-8999-999999999999'))).toBe('23503')
    })
  })

  it('post_stats returns only the posts asked for, at most 100, and zeros for none', async () => {
    const other = await as(db, 'authenticated', LOTTA, async () =>
      (await db.query<{ id: string }>(`insert into public.posts (body) values ('Annat') returning id`)).rows[0]!.id)
    await as(db, 'anon', null, async () => {
      expect((await stats([other])).map(r => r.post_id)).toEqual([other])
      expect(await stats([])).toEqual([])
      const many = [...Array.from({ length: 150 }, () => '99999999-9999-4999-8999-999999999999'), post]
      expect(await stats(many)).toEqual([]) // the 101st id is beyond the cap
    })
  })
})

describe('comments', () => {
  it('a supporter with a profile comments as themselves; everyone reads it with the author’s public name', async () => {
    const r = await as(db, 'authenticated', MATTIAS, () => comment('Vilken kväll! 💙'))
    expect(r.rows[0]!.author_id).toBe(MATTIAS)
    await as(db, 'anon', null, async () => {
      const { rows } = await db.query(`
        select c.body, pr.display_name, pr.handle from public.post_comments c
        left join public.profiles pr on pr.id = c.author_id where c.post_id = $1 order by c.created_at, c.id`, [post])
      expect(rows).toEqual([{ body: 'Vilken kväll! 💙', display_name: 'Mattias', handle: 'mattias' }])
      expect((await stats())[0]!.comments).toBe(1)
    })
  })

  it('commenting makes your public name visible; deleting your last comment makes it private again', async () => {
    expect(await publicHandles()).toEqual(['jarnmannen'])
    const id = (await as(db, 'authenticated', MATTIAS, () => comment('Hej!'))).rows[0]!.id
    expect(await publicHandles()).toEqual(['jarnmannen', 'mattias'])
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query('select created_at from public.profiles'))).toBe('42501')
    })
    await as(db, 'authenticated', MATTIAS, () => db.query('delete from public.post_comments where id = $1', [id]))
    expect(await publicHandles()).toEqual(['jarnmannen'])
  })

  it('anonymous visitors cannot comment, edit or delete', async () => {
    await as(db, 'authenticated', MATTIAS, () => comment('Mattias'))
    await as(db, 'anon', null, async () => {
      expect(await codeOf(comment('Anonym'))).toBe('42501')
      expect(await codeOf(db.query(`update public.post_comments set body = 'Hackad'`))).toBe('42501')
      expect(await codeOf(db.query('delete from public.post_comments'))).toBe('42501')
    })
  })

  it('needs a profile, and the author can never be supplied', async () => {
    await as(db, 'authenticated', NILS, async () => {
      expect(await codeOf(comment('Utan profil'))).toBe('42501')
    })
    await as(db, 'authenticated', MATTIAS, async () => {
      for (const [col, val] of [['author_id', LOTTA], ['author_id', MATTIAS], ['id', '66666666-6666-4666-8666-666666666666'], ['created_at', '2000-01-01']]) {
        expect(await codeOf(db.query(`insert into public.post_comments (post_id, body, ${col}) values ($1, 'x', $2)`, [post, val])), col).toBe('42501')
      }
    })
  })

  it('nobody can edit a comment; only the author can delete it', async () => {
    const id = (await as(db, 'authenticated', MATTIAS, () => comment('Mattias kommentar'))).rows[0]!.id
    for (const who of [MATTIAS, LOTTA, JARN]) {
      await as(db, 'authenticated', who, async () => {
        expect(await codeOf(db.query(`update public.post_comments set body = 'Ändrad'`))).toBe('42501')
      })
    }
    // Not even the post's author can delete someone else's comment.
    for (const who of [LOTTA, JARN]) {
      await as(db, 'authenticated', who, async () => {
        expect((await db.query('delete from public.post_comments')).affectedRows).toBe(0)
      })
    }
    await as(db, 'authenticated', MATTIAS, async () => {
      expect((await db.query('delete from public.post_comments where id = $1', [id])).affectedRows).toBe(1)
    })
  })

  it('enforces the rules', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      for (const bad of ['', ' ', ' leading', 'trailing ', 'x'.repeat(281), 'tab\there', 'bell\u0007']) {
        expect(await codeOf(comment(bad)), JSON.stringify(bad)).toBe('23514')
      }
      expect(await codeOf(comment('x'.repeat(280)))).toBe('ok')
      expect(await codeOf(comment('Rad ett\nRad två'))).toBe('ok')
      expect(await codeOf(comment('Okänt inlägg', '99999999-9999-4999-8999-999999999999'))).toBe('23503')
    })
  })
})

describe('cleanup', () => {
  it('when the author deletes a post, everyone’s comments and reactions on it go too', async () => {
    await as(db, 'authenticated', MATTIAS, async () => { await react('eld'); await comment('Mattias') })
    await as(db, 'authenticated', LOTTA, async () => { await react('hjarta'); await comment('Lotta') })
    await as(db, 'authenticated', JARN, async () => {
      expect((await db.query('delete from public.posts where id = $1', [post])).affectedRows).toBe(1)
    })
    expect((await db.query('select count(*)::int as n from public.post_comments')).rows).toEqual([{ n: 0 }])
    expect((await db.query('select count(*)::int as n from public.post_reactions')).rows).toEqual([{ n: 0 }])
    // With their comments gone, Mattias and Lotta are private again; so is Järnmannen.
    expect(await publicHandles()).toEqual([])
  })

  it('a deleted account takes its comments and reactions with it', async () => {
    await as(db, 'authenticated', MATTIAS, async () => { await react('eld'); await comment('Mattias') })
    await db.exec(`delete from auth.users where id = '${MATTIAS}'`)
    expect((await db.query('select count(*)::int as n from public.post_comments')).rows).toEqual([{ n: 0 }])
    expect((await db.query('select count(*)::int as n from public.post_reactions')).rows).toEqual([{ n: 0 }])
  })
})

describe('grants', () => {
  it('only the intended privileges exist', async () => {
    const table = await db.query<{ table_name: string, grantee: string, privilege_type: string }>(`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ('post_comments', 'post_reactions') and grantee in ('anon', 'authenticated', 'public')
      order by table_name, grantee, privilege_type`)
    expect(table.rows).toEqual([
      { table_name: 'post_comments', grantee: 'anon', privilege_type: 'SELECT' },
      { table_name: 'post_comments', grantee: 'authenticated', privilege_type: 'DELETE' },
      { table_name: 'post_comments', grantee: 'authenticated', privilege_type: 'SELECT' },
      { table_name: 'post_reactions', grantee: 'authenticated', privilege_type: 'DELETE' },
      { table_name: 'post_reactions', grantee: 'authenticated', privilege_type: 'SELECT' },
    ])
    const cols = await db.query<{ table_name: string, privilege_type: string, column_name: string }>(`
      select table_name, privilege_type, column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name in ('post_comments', 'post_reactions') and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
      order by table_name, privilege_type, column_name`)
    expect(cols.rows).toEqual([
      { table_name: 'post_comments', privilege_type: 'INSERT', column_name: 'body' },
      { table_name: 'post_comments', privilege_type: 'INSERT', column_name: 'post_id' },
      { table_name: 'post_reactions', privilege_type: 'INSERT', column_name: 'post_id' },
      { table_name: 'post_reactions', privilege_type: 'INSERT', column_name: 'reaction' },
      { table_name: 'post_reactions', privilege_type: 'UPDATE', column_name: 'reaction' },
    ])
    const fns = await db.query<{ fn: string, anon: boolean, authenticated: boolean, public: boolean }>(`
      select p.proname as fn,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
        coalesce((',' || array_to_string(p.proacl, ',')) like '%,=X/%', false) as public
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('post_stats', 'set_post_reaction') order by 1`)
    expect(fns.rows).toEqual([
      { fn: 'post_stats', anon: true, authenticated: true, public: false },
      { fn: 'set_post_reaction', anon: false, authenticated: true, public: false },
    ])
  })
})

describe('the pgTAP suite for the real database (supabase/tests)', () => {
  // Hosted databases aren't empty: the suite must pass around existing supporters, posts and interactions.
  it.each([['an empty database', false], ['a database with real supporters, posts and interactions', true]])('runs green against %s', async (_label, withRealData) => {
    await db.exec('delete from auth.users')
    if (withRealData) {
      await seedRealData(db)
      // Plus a real comment and reaction on the real post.
      await db.exec(`
        insert into public.post_comments (post_id, author_id, body) select id, author_id, 'Riktig kommentar' from public.posts;
        insert into public.post_reactions (post_id, user_id, reaction) select id, author_id, 'hjarta' from public.posts;`)
    }
    const before = await realDataSnapshot(db)
    const reactionsBefore = (await db.query('select post_id, user_id, reaction from public.post_reactions order by 1, 2')).rows
    const { lines, planned } = await runPgTapFile(db, 'interactions_rls.test.sql')
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(db)).toEqual(before)
    expect((await db.query('select post_id, user_id, reaction from public.post_reactions order by 1, 2')).rows).toEqual(reactionsBefore)
  })
})
