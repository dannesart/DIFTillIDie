import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { as, codeOf, createSupabaseLikeDb, realDataSnapshot, seedRealData } from './db/supabase-harness'

/*
 * Database authorization for public.posts and the public author names it
 * exposes, with three users: Hasse and Lotta have profiles, Nils doesn't.
 * Runs the real migrations in PGlite (see supabase-harness). Codes: 42501
 * permission denied (grant or RLS), 23514 check violation.
 */

const LOTTA = '11111111-1111-4111-8111-111111111111'
const HASSE = '22222222-2222-4222-8222-222222222222'
const NILS = '33333333-3333-4333-8333-333333333333'

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${LOTTA}', 'lotta@example.test'), ('${HASSE}', 'hasse@example.test'), ('${NILS}', 'nils@example.test')`)
  await as(db, 'authenticated', HASSE, () => db.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Hovet-Hasse', 'hovethasse')`, [HASSE]))
  await as(db, 'authenticated', LOTTA, () => db.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Lotta från Gärdet', 'kaminen81')`, [LOTTA]))
})

const publish = (body: string, extra: Record<string, string> = {}) => {
  const cols = ['body', ...Object.keys(extra)]
  return db.query(`insert into public.posts (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, author_id`, [body, ...Object.values(extra)])
}

// The feed query the app makes through PostgREST, as plain SQL.
const FEED = `
  select p.id, p.body, p.sport, p.story_id, pr.display_name, pr.handle
  from public.posts p left join public.profiles pr on pr.id = p.author_id
  order by p.created_at desc, p.id desc`

describe('public reading', () => {
  it('anyone can read posts with the author’s public name, without signing in', async () => {
    await as(db, 'authenticated', HASSE, () => publish('Järnkaminen brinner!', { sport: 'hockey' }))
    const rows = await as(db, 'anon', null, () => db.query(FEED))
    expect(rows.rows).toEqual([expect.objectContaining({ body: 'Järnkaminen brinner!', sport: 'hockey', display_name: 'Hovet-Hasse', handle: 'hovethasse' })])
  })

  it('shows only intentional author information: never timestamps, e-mail or private accounts', async () => {
    await as(db, 'authenticated', HASSE, () => publish('Hej'))
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query('select created_at from public.profiles'))).toBe('42501')
      expect(await codeOf(db.query('select * from public.profiles'))).toBe('42501')
      expect(await codeOf(db.query('select email from auth.users'))).toBe('42501')
      // Lotta has never posted: her profile stays private.
      expect((await db.query('select id from public.profiles')).rows).toEqual([{ id: HASSE }])
    })
    await as(db, 'authenticated', NILS, async () => {
      expect((await db.query('select handle from public.profiles')).rows).toEqual([{ handle: 'hovethasse' }])
    })
  })

  it('newest first', async () => {
    await as(db, 'authenticated', HASSE, () => publish('Först'))
    await db.exec(`update public.posts set created_at = now() - interval '1 hour'`) // as owner
    await as(db, 'authenticated', LOTTA, () => publish('Sen'))
    const rows = await as(db, 'anon', null, () => db.query<{ body: string }>(FEED))
    expect(rows.rows.map(r => r.body)).toEqual(['Sen', 'Först'])
  })
})

describe('publishing', () => {
  it('a supporter with a profile publishes as themselves; the database sets author and time', async () => {
    const r = await as(db, 'authenticated', LOTTA, () => publish('Heja Djurgår’n!', { story_id: 'story-aftonbladet-1a8xvsa' }))
    expect(r.rows).toEqual([{ id: expect.any(String), author_id: LOTTA }])
    const { rows } = await db.query<{ fresh: boolean }>(`select created_at > now() - interval '1 minute' as fresh from public.posts`)
    expect(rows[0]!.fresh).toBe(true)
  })

  it('anonymous visitors cannot publish, edit or delete', async () => {
    await as(db, 'authenticated', HASSE, () => publish('Hasses inlägg'))
    await as(db, 'anon', null, async () => {
      expect(await codeOf(publish('Anonymt'))).toBe('42501')
      expect(await codeOf(db.query(`update public.posts set body = 'Hackat'`))).toBe('42501')
      expect(await codeOf(db.query('delete from public.posts'))).toBe('42501')
    })
    expect((await db.query('select body from public.posts')).rows).toEqual([{ body: 'Hasses inlägg' }])
  })

  it('signed in without a profile is not enough', async () => {
    await as(db, 'authenticated', NILS, async () => {
      expect(await codeOf(publish('Utan profil'))).toBe('42501')
    })
  })

  it('the author can never be chosen by the client, not even as yourself', async () => {
    await as(db, 'authenticated', HASSE, async () => {
      expect(await codeOf(publish('Jag är Lotta', { author_id: LOTTA }))).toBe('42501')
      expect(await codeOf(publish('Jag är jag', { author_id: HASSE }))).toBe('42501')
      expect(await codeOf(publish('Mitt eget id', { id: '44444444-4444-4444-8444-444444444444' }))).toBe('42501')
      expect(await codeOf(publish('Backdaterat', { created_at: '2000-01-01' }))).toBe('42501')
    })
    expect((await db.query('select count(*)::int as n from public.posts')).rows).toEqual([{ n: 0 }])
  })

  it('enforces the rules', async () => {
    await as(db, 'authenticated', HASSE, async () => {
      for (const bad of ['', ' ', '\n', ' leading', 'trailing ', 'x'.repeat(281), 'tab\there', 'bell\u0007']) {
        expect(await codeOf(publish(bad)), JSON.stringify(bad)).toBe('23514')
      }
      expect(await codeOf(publish('Bandy', { sport: 'bandy' }))).toBe('23514')
      expect(await codeOf(publish('Konstig story', { story_id: 'story id with spaces' }))).toBe('23514')
      // Allowed: newlines inside, emoji, exactly 280 characters, both sports.
      expect(await codeOf(publish('Rad ett\nRad två 💙'))).toBe('ok')
      expect(await codeOf(publish('x'.repeat(280)))).toBe('ok')
      expect(await codeOf(publish('Mål!', { sport: 'fotboll' }))).toBe('ok')
    })
  })
})

describe('someone else’s posts', () => {
  beforeEach(async () => {
    await as(db, 'authenticated', HASSE, () => publish('Hasses inlägg'))
  })

  it('cannot be edited by anyone, including the author', async () => {
    for (const who of [LOTTA, HASSE]) {
      await as(db, 'authenticated', who, async () => {
        expect(await codeOf(db.query(`update public.posts set body = 'Ändrat'`))).toBe('42501')
        expect(await codeOf(db.query(`update public.posts set author_id = $1`, [LOTTA]))).toBe('42501')
      })
    }
  })

  it('cannot be deleted by another supporter, with or without WHERE', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect((await db.query('delete from public.posts where author_id = $1', [HASSE])).affectedRows).toBe(0)
      expect((await db.query('delete from public.posts')).affectedRows).toBe(0)
    })
    expect((await db.query('select count(*)::int as n from public.posts')).rows).toEqual([{ n: 1 }])
  })

  it('the author can delete their own post, and only that', async () => {
    await as(db, 'authenticated', LOTTA, () => publish('Lottas inlägg'))
    await as(db, 'authenticated', HASSE, async () => {
      expect((await db.query('delete from public.posts')).affectedRows).toBe(1)
    })
    expect((await db.query('select body from public.posts')).rows).toEqual([{ body: 'Lottas inlägg' }])
  })

  it('a supporter’s posts disappear with their account', async () => {
    await db.exec(`delete from auth.users where id = '${HASSE}'`)
    expect((await db.query('select count(*)::int as n from public.posts')).rows).toEqual([{ n: 0 }])
  })
})

describe('grants', () => {
  it('only the intended privileges exist', async () => {
    const table = await db.query<{ grantee: string, privilege_type: string }>(`
      select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'posts' and grantee in ('anon', 'authenticated', 'public')
      order by grantee, privilege_type`)
    expect(table.rows).toEqual([
      { grantee: 'anon', privilege_type: 'SELECT' },
      { grantee: 'authenticated', privilege_type: 'DELETE' },
      { grantee: 'authenticated', privilege_type: 'SELECT' },
    ])
    const insert = await db.query<{ column_name: string }>(`
      select column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'posts' and grantee = 'authenticated' and privilege_type = 'INSERT'
      order by column_name`)
    expect(insert.rows.map(r => r.column_name)).toEqual(['body', 'sport', 'story_id'])
  })
})

describe('the pgTAP suite for the real database (supabase/tests)', () => {
  // Hosted databases aren't empty: the suite must pass around existing supporters and posts, and leave them alone.
  it.each([['an empty database', false], ['a database with a real supporter and post', true]])('runs green against %s', async (_label, withRealData) => {
    // The suite creates its own users.
    await db.exec('delete from auth.users')
    if (withRealData) await seedRealData(db)
    const before = await realDataSnapshot(db)
    const { lines, planned } = await runPgTapFile(db, 'posts_rls.test.sql')
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    // Rolled back: nothing from the suite is left behind, and existing data is untouched.
    expect(await realDataSnapshot(db)).toEqual(before)
  })
})
