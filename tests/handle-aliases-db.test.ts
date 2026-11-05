import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { applyMigrations, as, codeOf, createSupabaseLikeDb, realDataSnapshot, REAL_SUPPORTER, seedRealData } from './db/supabase-harness'

/*
 * Supporter pages by handle, and old handles as aliases: reserved for the
 * supporter who used them, readable exactly when the profile is, and
 * written only by the database.
 */

const MIGRATION = '20261105231000_profile_handle_aliases.sql'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const HASSE = '22222222-2222-4222-8222-222222222222'

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${LOTTA}', 'lotta@example.test'), ('${HASSE}', 'hasse@example.test')`)
  await as(db, 'authenticated', LOTTA, () => db.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Lotta', 'lotta')`, [LOTTA]))
  await as(db, 'authenticated', HASSE, () => db.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Hasse', 'hasse')`, [HASSE]))
})

const rename = (id: string, handle: string) => db.query('update public.profiles set handle = $1 where id = $2', [handle, id])
const claim = (id: string, handle: string) => as(db, 'authenticated', id, () => rename(id, handle))
const aliasesOf = async (id: string) => (await db.query<{ handle: string }>('select handle from public.profile_handle_aliases where profile_id = $1 order by retired_at', [id])).rows.map(r => r.handle)
const resolve = (handle: string) => db.query<{ profile_id: string }>('select profile_id from public.profile_handle_aliases where handle = $1', [handle])
const publish = (id: string) => as(db, 'authenticated', id, () => db.query(`select public.publish_post('Hej från läktaren')`))

describe('changing your handle', () => {
  it('keeps the old one as an alias of the same supporter', async () => {
    await claim(LOTTA, 'lotta_g')
    await claim(LOTTA, 'kaminen81')
    expect(await aliasesOf(LOTTA)).toEqual(['lotta', 'lotta_g'])
    expect((await db.query('select handle from public.profiles where id = $1', [LOTTA])).rows).toEqual([{ handle: 'kaminen81' }])
  })

  it('a retired handle stays yours: nobody else can take it, so old links never point at someone else', async () => {
    await claim(LOTTA, 'lotta_g')
    expect(await codeOf(claim(HASSE, 'lotta'))).toBe('23505')
    await db.exec(`insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'ny@example.test')`)
    expect(await codeOf(as(db, 'authenticated', '33333333-3333-4333-8333-333333333333', () =>
      db.query(`insert into public.profiles (id, display_name, handle) values ('33333333-3333-4333-8333-333333333333', 'Ny', 'lotta')`)))).toBe('23505')
    expect((await db.query('select handle from public.profiles where id = $1', [HASSE])).rows).toEqual([{ handle: 'hasse' }])
  })

  it('…and you can take it back', async () => {
    await claim(LOTTA, 'lotta_g')
    await claim(LOTTA, 'lotta')
    expect(await aliasesOf(LOTTA)).toEqual(['lotta_g'])
  })

  it('keeps the 5 most recent; older ones are released', async () => {
    for (const h of ['l_1', 'l_2', 'l_3', 'l_4', 'l_5', 'l_6']) await claim(LOTTA, h)
    expect(await aliasesOf(LOTTA)).toEqual(['l_1', 'l_2', 'l_3', 'l_4', 'l_5'])
    expect(await codeOf(claim(HASSE, 'lotta'))).toBe('ok')
  })

  it('a refused change leaves no alias behind', async () => {
    expect(await codeOf(claim(LOTTA, 'hasse'))).toBe('23505')
    expect(await codeOf(claim(LOTTA, 'Ogiltig!'))).toBe('23514')
    expect(await aliasesOf(LOTTA)).toEqual([])
  })

  it('changing only the name records nothing', async () => {
    await as(db, 'authenticated', LOTTA, () => db.query(`update public.profiles set display_name = 'Lotta G' where id = $1`, [LOTTA]))
    expect(await aliasesOf(LOTTA)).toEqual([])
  })
})

describe('who can see an alias', () => {
  beforeEach(async () => {
    await claim(LOTTA, 'lotta_g')
  })

  it('before posting: only the supporter themselves (so an alias never reveals an unpublished profile)', async () => {
    await as(db, 'anon', null, async () => expect((await resolve('lotta')).rows).toEqual([]))
    await as(db, 'authenticated', HASSE, async () => expect((await resolve('lotta')).rows).toEqual([]))
    await as(db, 'authenticated', LOTTA, async () => expect((await resolve('lotta')).rows).toEqual([{ profile_id: LOTTA }]))
  })

  it('once they have posted: everyone, like the profile', async () => {
    await publish(LOTTA)
    await as(db, 'anon', null, async () => expect((await resolve('lotta')).rows).toEqual([{ profile_id: LOTTA }]))
    await as(db, 'authenticated', HASSE, async () => expect((await resolve('lotta')).rows).toEqual([{ profile_id: LOTTA }]))
  })

  it('never when it was retired', async () => {
    await publish(LOTTA)
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query('select retired_at from public.profile_handle_aliases'))).toBe('42501')
    })
  })
})

describe('nobody writes aliases but the database', () => {
  it('no insert, update or delete for anyone through the API', async () => {
    await claim(LOTTA, 'lotta_g')
    await publish(LOTTA)
    for (const [role, sub] of [['anon', null], ['authenticated', HASSE], ['authenticated', LOTTA]] as const) {
      await as(db, role, sub, async () => {
        expect(await codeOf(db.query(`insert into public.profile_handle_aliases (handle, profile_id) values ('fake_lotta', $1)`, [LOTTA])), `${role} insert`).toBe('42501')
        expect(await codeOf(db.query(`update public.profile_handle_aliases set profile_id = $1`, [HASSE])), `${role} update`).toBe('42501')
        expect(await codeOf(db.query('delete from public.profile_handle_aliases')), `${role} delete`).toBe('42501')
      })
    }
    expect(await aliasesOf(LOTTA)).toEqual(['lotta'])
  })

  it('the trigger function can’t be called directly', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(db.query('select public.profiles_handle_aliases()'))).not.toBe('ok')
    })
  })

  it('aliases go with the profile', async () => {
    await claim(LOTTA, 'lotta_g')
    await db.query('delete from auth.users where id = $1', [LOTTA])
    expect((await db.query('select * from public.profile_handle_aliases')).rows).toEqual([])
  })
})

describe('the migration', () => {
  it('keeps existing profiles and posts, and starts with no aliases', async () => {
    const d = await createSupabaseLikeDb({ stopBefore: MIGRATION })
    await seedRealData(d)
    const before = await realDataSnapshot(d)
    await applyMigrations(d, { from: MIGRATION })
    expect(await realDataSnapshot(d)).toEqual(before)
    expect((await d.query('select count(*)::int as n from public.profile_handle_aliases')).rows).toEqual([{ n: 0 }])
    // The existing supporter can still change their handle, and keeps the old one.
    await as(d, 'authenticated', REAL_SUPPORTER, () => d.query(`update public.profiles set handle = 'jarnkaminen' where id = $1`, [REAL_SUPPORTER]))
    expect((await d.query('select handle from public.profile_handle_aliases')).rows).toEqual([{ handle: 'jarnmannen' }])
  })
})

describe('supabase/tests/handle_aliases_rls.test.sql', () => {
  it.each([false, true])('passes and leaves nothing behind (existing data: %s)', async (withRealData) => {
    const d = await createSupabaseLikeDb()
    if (withRealData) await seedRealData(d)
    const before = await realDataSnapshot(d)
    const { lines, planned } = await runPgTapFile(d, 'handle_aliases_rls.test.sql')
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(d)).toEqual(before)
    expect((await d.query('select count(*)::int as n from public.profile_handle_aliases')).rows).toEqual([{ n: 0 }])
  })
})
