import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { applyMigrations, as, codeOf, createSupabaseLikeDb, realDataSnapshot, seedRealData } from './db/supabase-harness'

/*
 * Public follow counts (#9 v1.1): supporter_follow_counts(). Runs the real
 * migrations in PGlite (see supabase-harness). The same rules are checked on
 * a disposable Supabase stack by supabase/tests/follow_counts.test.sql.
 *   Järnmannen and Lotta are public (they have posted),
 *   Kim is public through a comment only,
 *   Mattias has a profile but has never posted (private),
 *   GHOST doesn't exist at all.
 */

const JARN = '44444444-4444-4444-8444-444444444444'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const MATTIAS = '55555555-5555-4555-8555-555555555555'
const KIM = '66666666-6666-4666-8666-666666666666'
const GHOST = '99999999-9999-4999-8999-999999999999'

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${JARN}', 'j@example.test'), ('${LOTTA}', 'l@example.test'), ('${MATTIAS}', 'm@example.test'), ('${KIM}', 'k@example.test')`)
  for (const [id, name, handle] of [[JARN, 'Järnmannen', 'jarnmannen'], [LOTTA, 'Lotta', 'lotta_g'], [MATTIAS, 'Mattias', 'mattias'], [KIM, 'Kim', 'kim']] as const) {
    await as(db, 'authenticated', id, () => db.query('insert into public.profiles (id, display_name, handle) values ($1, $2, $3)', [id, name, handle]))
  }
  for (const id of [JARN, LOTTA]) await as(db, 'authenticated', id, () => db.query(`select public.publish_post('Hej från läktaren')`))
})

const counts = (id: string) => db.query<{ followers: number, following: number }>('select * from public.supporter_follow_counts($1)', [id]).then(r => r.rows)
const follow = (who: string, whom: string) => as(db, 'authenticated', who, () => db.query('select public.follow_supporter($1)', [whom]))
const comment = async (who: string) => {
  const post = (await db.query<{ id: string }>('select id from public.posts limit 1')).rows[0]!.id
  await as(db, 'authenticated', who, () => db.query('insert into public.post_comments (post_id, body) values ($1, $2)', [post, 'Heja!']))
}

describe('public follow counts', () => {
  it('anyone, even signed out, gets two numbers for a public supporter', async () => {
    await follow(MATTIAS, JARN) // a private supporter's follow counts too
    await follow(LOTTA, JARN)
    await follow(JARN, LOTTA)
    for (const viewer of [null, LOTTA, MATTIAS]) {
      await as(db, viewer ? 'authenticated' : 'anon', viewer, async () => {
        expect(await counts(JARN)).toEqual([{ followers: 2, following: 1 }])
        expect(await counts(LOTTA)).toEqual([{ followers: 1, following: 1 }])
      })
    }
  })

  it('returns only the two numbers: never who', async () => {
    const r = await db.query<{ n: string }>(`select unnest(proargnames) as n from pg_proc where proname = 'supporter_follow_counts'`)
    expect(r.rows.map(x => x.n)).toEqual(['p_profile_id', 'followers', 'following'])
  })

  it('a private supporter and a missing one give the same answer: no row', async () => {
    await follow(MATTIAS, JARN)
    for (const viewer of [null, LOTTA]) {
      await as(db, viewer ? 'authenticated' : 'anon', viewer, async () => {
        expect(await counts(MATTIAS)).toEqual([])
        expect(await counts(GHOST)).toEqual([])
      })
    }
  })

  it('a supporter always sees their own numbers, public or not', async () => {
    await follow(MATTIAS, JARN)
    await as(db, 'authenticated', MATTIAS, async () => expect(await counts(MATTIAS)).toEqual([{ followers: 0, following: 1 }]))
  })

  it('a comment makes a supporter public, as in the profiles rule', async () => {
    await follow(LOTTA, JARN)
    await as(db, 'anon', null, async () => expect(await counts(KIM)).toEqual([]))
    await comment(KIM)
    await as(db, 'anon', null, async () => expect(await counts(KIM)).toEqual([{ followers: 0, following: 0 }]))
  })

  it('"following" counts public supporters only, so it matches "Du följer"', async () => {
    await follow(LOTTA, JARN)
    await follow(LOTTA, KIM).catch(() => {}) // Kim is private: not followable
    await as(db, 'anon', null, async () => expect(await counts(LOTTA)).toEqual([{ followers: 0, following: 1 }]))
    // Järnmannen goes private again (deletes his only post): Lotta still follows him, but he no longer counts
    await as(db, 'authenticated', JARN, () => db.query('delete from public.posts where author_id = $1', [JARN]))
    await as(db, 'anon', null, async () => expect(await counts(LOTTA)).toEqual([{ followers: 0, following: 0 }]))
    await as(db, 'authenticated', LOTTA, async () => {
      expect((await db.query('select id from public.followed_supporters()')).rows).toEqual([])
      expect(await counts(LOTTA)).toEqual([{ followers: 0, following: 0 }])
    })
  })

  it('follow and unfollow move the numbers', async () => {
    await follow(MATTIAS, JARN)
    await as(db, 'anon', null, async () => expect(await counts(JARN)).toEqual([{ followers: 1, following: 0 }]))
    await as(db, 'authenticated', MATTIAS, () => db.query('select public.unfollow_supporter($1)', [JARN]))
    await as(db, 'anon', null, async () => expect(await counts(JARN)).toEqual([{ followers: 0, following: 0 }]))
  })

  it('counts come back exactly when the profile is readable (the restated rule stays in step with the profiles policy)', async () => {
    await comment(KIM)
    for (const viewer of [null, LOTTA, MATTIAS, KIM]) {
      await as(db, viewer ? 'authenticated' : 'anon', viewer, async () => {
        for (const id of [JARN, LOTTA, MATTIAS, KIM, GHOST]) {
          const readable = (await db.query('select 1 from public.profiles where id = $1', [id])).rows.length === 1
          expect((await counts(id)).length === 1, `${viewer} → ${id}`).toBe(readable)
        }
      })
    }
  })
})

describe('Following v1 stays private', () => {
  it('who follows whom is still unreadable to anyone but the follower', async () => {
    await follow(MATTIAS, JARN)
    await as(db, 'anon', null, async () => expect(await codeOf(db.query('select * from public.supporter_follows'))).toBe('42501'))
    for (const other of [LOTTA, JARN]) {
      await as(db, 'authenticated', other, async () => expect((await db.query('select * from public.supporter_follows')).rows).toEqual([]))
    }
    await as(db, 'authenticated', MATTIAS, async () => expect((await db.query('select followed_id from public.supporter_follows')).rows).toEqual([{ followed_id: JARN }]))
  })
})

describe('the function', () => {
  it('is SECURITY DEFINER with an empty search_path, owned like the tables, executable by anon and authenticated, not PUBLIC', async () => {
    const r = (await db.query<{ def: boolean, cfg: string[], sameOwner: boolean, anon: boolean, auth: boolean, pub: boolean, forced: boolean }>(`
      select p.prosecdef as def, p.proconfig as cfg,
             pg_get_userbyid(p.proowner) = (select tableowner from pg_tables where schemaname = 'public' and tablename = 'supporter_follows') as "sameOwner",
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as pub,
             exists (select 1 from pg_class c where c.relname in ('supporter_follows', 'posts', 'post_comments') and c.relnamespace = 'public'::regnamespace and c.relforcerowsecurity) as forced
        from pg_proc p where p.proname = 'supporter_follow_counts'`)).rows[0]!
    expect(r).toEqual({ def: true, cfg: ['search_path=""'], sameOwner: true, anon: true, auth: true, pub: false, forced: false })
  })
})

describe('the migration', () => {
  it('leaves real supporters, posts, comments and follows untouched', async () => {
    const d = await createSupabaseLikeDb({ stopBefore: '20261115120000_supporter_follow_counts.sql' })
    await seedRealData(d)
    const before = await realDataSnapshot(d)
    await applyMigrations(d, { from: '20261115120000_supporter_follow_counts.sql' })
    expect(await realDataSnapshot(d)).toEqual(before)
  })
})

describe('supabase/tests/follow_counts.test.sql', () => {
  it.each([false, true])('passes every assertion (with real data: %s), and leaves nothing behind', async (withRealData) => {
    const d = await createSupabaseLikeDb()
    if (withRealData) await seedRealData(d)
    const before = await realDataSnapshot(d)
    const { lines, planned } = await runPgTapFile(d, 'follow_counts.test.sql')
    expect(lines.filter(l => !l.startsWith('ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(d)).toEqual(before)
  })
})
