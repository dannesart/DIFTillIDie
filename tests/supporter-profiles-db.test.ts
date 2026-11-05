import { beforeEach, describe, expect, it } from 'vitest'
import { AVATARS, TEAM_INTERESTS } from '../shared/utils/profile'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { applyMigrations, as, codeOf, createSupabaseLikeDb, realDataSnapshot, REAL_SUPPORTER, seedRealData } from './db/supabase-harness'

/*
 * Supporter profiles: a public bio and avatar design (public exactly when the
 * name and handle are), private team interests, and a supporter's wall.
 * Codes: 42501 not allowed (grant or RLS), 23514 rule broken, 23503 no profile.
 */

const MIGRATION = '20261105220958_supporter_profiles.sql'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const HASSE = '22222222-2222-4222-8222-222222222222'
const NOBODY = '33333333-3333-4333-8333-333333333333' // signed in, no profile yet

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${LOTTA}', 'lotta@example.test'), ('${HASSE}', 'hasse@example.test'), ('${NOBODY}', 'nobody@example.test')`)
  await as(db, 'authenticated', LOTTA, () => db.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Lotta från Gärdet', 'lotta')`, [LOTTA]))
  await as(db, 'authenticated', HASSE, () => db.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Hovet-Hasse', 'hasse')`, [HASSE]))
})

const setDesign = (id: string, bio: string | null, avatar: string | null) =>
  db.query('update public.profiles set bio = $1, avatar = $2 where id = $3 returning bio, avatar', [bio, avatar, id])
const publish = (body: string) => db.query('select id from public.publish_post($1)', [body])
const save = (teams: string[] | null) => db.query<{ teams: string[] }>('select teams from public.save_team_interests($1)', [teams])

describe('bio and avatar', () => {
  it('the supporter sets and clears their own', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect((await setDesign(LOTTA, 'Sektion A sedan 1998. Järnkaminer och kaffe.', 'halsduk')).rows).toEqual([{ bio: 'Sektion A sedan 1998. Järnkaminer och kaffe.', avatar: 'halsduk' }])
      expect((await setDesign(LOTTA, null, null)).rows).toEqual([{ bio: null, avatar: null }])
    })
  })

  it('follow the rules: 1–160 characters, trimmed, one paragraph, a known design', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(setDesign(LOTTA, 'x'.repeat(161), null))).toBe('23514')
      expect(await codeOf(setDesign(LOTTA, ' Blåränder ', null))).toBe('23514')
      expect(await codeOf(setDesign(LOTTA, '', null))).toBe('23514')
      expect(await codeOf(setDesign(LOTTA, 'Rad ett\nrad två', null))).toBe('23514')
      expect(await codeOf(setDesign(LOTTA, null, 'dif-logga'))).toBe('23514')
      expect(await codeOf(setDesign(LOTTA, '💙'.repeat(160), 'puck'))).toBe('ok')
    })
  })

  it('every design the app offers is accepted', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      for (const a of AVATARS) expect(await codeOf(setDesign(LOTTA, null, a.key)), a.key).toBe('ok')
    })
  })

  it('nobody changes someone else’s', async () => {
    await as(db, 'authenticated', HASSE, () => publish('Hasse syns'))
    await as(db, 'authenticated', LOTTA, async () => {
      expect((await setDesign(HASSE, 'Hackad', 'boll')).rows).toEqual([])
    })
    await as(db, 'anon', null, async () => {
      expect(await codeOf(setDesign(HASSE, 'Hackad', 'boll'))).toBe('42501')
    })
    expect((await db.query('select bio, avatar from public.profiles where id = $1', [HASSE])).rows).toEqual([{ bio: null, avatar: null }])
  })

  it('are public exactly when the name is: after posting or commenting, never before', async () => {
    await as(db, 'authenticated', LOTTA, () => setDesign(LOTTA, 'Bara jag ser detta än', 'stjarna'))
    const read = () => db.query('select id, display_name, handle, bio, avatar from public.profiles where id = $1', [LOTTA])
    await as(db, 'anon', null, async () => expect((await read()).rows).toEqual([]))
    await as(db, 'authenticated', HASSE, async () => expect((await read()).rows).toEqual([]))
    // Her own: always.
    await as(db, 'authenticated', LOTTA, async () => expect((await read()).rows).toHaveLength(1))

    await as(db, 'authenticated', LOTTA, () => publish('Nu kliver jag fram'))
    const pub = { id: LOTTA, display_name: 'Lotta från Gärdet', handle: 'lotta', bio: 'Bara jag ser detta än', avatar: 'stjarna' }
    await as(db, 'anon', null, async () => expect((await read()).rows).toEqual([pub]))
    await as(db, 'authenticated', HASSE, async () => expect((await read()).rows).toEqual([pub]))
  })

  it('a public profile still never shows its timestamps', async () => {
    await as(db, 'authenticated', LOTTA, () => publish('Hej'))
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query('select created_at from public.profiles'))).toBe('42501')
      expect(await codeOf(db.query('select updated_at from public.profiles'))).toBe('42501')
      expect(await codeOf(db.query('select * from public.profiles'))).toBe('42501')
    })
  })
})

describe('team interests', () => {
  it('the supporter saves any combination, sorted and without repeats; empty is fine', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect((await save(['hockey:dam', 'fotboll:herr', 'hockey:dam'])).rows).toEqual([{ teams: ['fotboll:herr', 'hockey:dam'] }])
      expect((await save(TEAM_INTERESTS.map(t => t.key))).rows[0]!.teams).toHaveLength(4)
      expect((await save([])).rows).toEqual([{ teams: [] }])
      expect((await save(null)).rows).toEqual([{ teams: [] }])
      expect((await db.query('select profile_id, teams from public.profile_preferences')).rows).toEqual([{ profile_id: LOTTA, teams: [] }])
    })
  })

  it('only the four teams, regardless of what the feeds cover today', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(save(['bandy:herr']))).toBe('23514')
      expect(await codeOf(save(['fotboll']))).toBe('23514')
      expect(await codeOf(save([null as unknown as string]))).toBe('23514')
      // Hockey dam has no fixtures or feed yet; following it is still yours to choose.
      expect(await codeOf(save(['hockey:dam']))).toBe('ok')
    })
  })

  it('are private: nobody else reads, writes or forges them', async () => {
    await as(db, 'authenticated', LOTTA, () => save(['fotboll:dam']))
    await as(db, 'authenticated', LOTTA, () => publish('Lotta är publik nu'))
    await as(db, 'authenticated', HASSE, async () => {
      expect((await db.query('select * from public.profile_preferences')).rows).toEqual([])
      expect((await db.query(`update public.profile_preferences set teams = '{hockey:herr}' returning profile_id`)).rows).toEqual([])
      expect(await codeOf(db.query('insert into public.profile_preferences (profile_id, teams) values ($1, $2)', [LOTTA, ['hockey:herr']]))).toBe('42501')
      expect(await codeOf(db.query('update public.profile_preferences set profile_id = $1', [LOTTA]))).toBe('42501')
      expect(await codeOf(db.query('delete from public.profile_preferences'))).toBe('42501')
      // His own save writes his own row only.
      expect((await save(['hockey:herr'])).rows).toEqual([{ teams: ['hockey:herr'] }])
    })
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query('select * from public.profile_preferences'))).toBe('42501')
      expect(await codeOf(save(['fotboll:herr']))).toBe('42501')
    })
    const rows = (await db.query('select profile_id, teams from public.profile_preferences order by profile_id')).rows
    expect(rows).toEqual([{ profile_id: LOTTA, teams: ['fotboll:dam'] }, { profile_id: HASSE, teams: ['hockey:herr'] }])
  })

  it('need a profile first', async () => {
    await as(db, 'authenticated', NOBODY, async () => {
      expect(await codeOf(save(['fotboll:herr']))).toBe('23503')
    })
  })

  it('updated_at is the database’s', async () => {
    await as(db, 'authenticated', LOTTA, () => db.query(`insert into public.profile_preferences (teams) values ('{fotboll:herr}')`))
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(db.query(`update public.profile_preferences set updated_at = '2000-01-01'`))).toBe('42501')
    })
    const { rows } = await db.query<{ fresh: boolean }>(`select updated_at > now() - interval '1 minute' as fresh from public.profile_preferences`)
    expect(rows[0]!.fresh).toBe(true)
  })

  it('go when the profile goes', async () => {
    await as(db, 'authenticated', LOTTA, () => save(['fotboll:herr']))
    await db.query('delete from auth.users where id = $1', [LOTTA])
    expect((await db.query('select * from public.profile_preferences')).rows).toEqual([])
  })
})

describe('a supporter’s wall', () => {
  it('is their posts, newest first, a page at a time, with a true count; posts stay public', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      for (let i = 1; i <= 5; i++) await publish(`Lotta ${i}`)
    })
    await as(db, 'authenticated', HASSE, () => publish('Hasse 1'))
    await db.exec(`update public.posts set created_at = now() - (substring(body from '[0-9]+$')::int * interval '1 minute')`)
    await as(db, 'anon', null, async () => {
      const page = (after?: { created_at: string, id: string }) => db.query<{ id: string, body: string, created_at: string }>(
        `select id, body, created_at from public.posts where author_id = $1
         and ($2::timestamptz is null or created_at < $2 or (created_at = $2 and id < $3::uuid))
         order by created_at desc, id desc limit 2`, [LOTTA, after?.created_at ?? null, after?.id ?? null])
      const first = (await page()).rows
      const second = (await page(first.at(-1))).rows
      const third = (await page(second.at(-1))).rows
      expect([...first, ...second, ...third].map(r => r.body)).toEqual(['Lotta 1', 'Lotta 2', 'Lotta 3', 'Lotta 4', 'Lotta 5'])
      expect((await db.query<{ n: number }>('select count(*)::int as n from public.posts where author_id = $1', [LOTTA])).rows[0]!.n).toBe(5)
    })
    const idx = await db.query(`select indexdef from pg_indexes where indexname = 'posts_author_created_at_idx'`)
    expect(idx.rows).toHaveLength(1)
  })
})

describe('the migration', () => {
  it('keeps existing profiles and posts as they were', async () => {
    const d = await createSupabaseLikeDb({ stopBefore: MIGRATION })
    await seedRealData(d)
    const before = await realDataSnapshot(d)
    await applyMigrations(d, { from: MIGRATION })
    expect(await realDataSnapshot(d)).toEqual(before)
    expect((await d.query('select bio, avatar from public.profiles where id = $1', [REAL_SUPPORTER])).rows).toEqual([{ bio: null, avatar: null }])
    expect((await d.query('select count(*)::int as n from public.profile_preferences')).rows).toEqual([{ n: 0 }])
  })
})

describe('supabase/tests/supporter_profiles_rls.test.sql', () => {
  it.each([false, true])('passes and leaves nothing behind (existing data: %s)', async (withRealData) => {
    const d = await createSupabaseLikeDb()
    if (withRealData) await seedRealData(d)
    const before = await realDataSnapshot(d)
    const { lines, planned } = await runPgTapFile(d, 'supporter_profiles_rls.test.sql')
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(d)).toEqual(before)
    expect((await d.query('select count(*)::int as n from public.profile_preferences')).rows).toEqual([{ n: 0 }])
  })
})
