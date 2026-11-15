import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { applyMigrations, as, codeOf, createSupabaseLikeDb, realDataSnapshot, seedRealData } from './db/supabase-harness'

/*
 * Following supporters (#9), private in v1. Runs the real migrations in
 * PGlite (see supabase-harness). Five users:
 *   Järnmannen and Lotta are public (they have posted),
 *   Mattias has a profile but has never posted (private),
 *   Nils is signed in without a profile,
 *   GHOST doesn't exist at all.
 * Codes: 42501 not allowed (grant or RLS), 23514 rule broken, P0002 no public supporter.
 */

const JARN = '44444444-4444-4444-8444-444444444444'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const MATTIAS = '55555555-5555-4555-8555-555555555555'
const NILS = '33333333-3333-4333-8333-333333333333'
const GHOST = '99999999-9999-4999-8999-999999999999'

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${JARN}', 'j@example.test'), ('${LOTTA}', 'l@example.test'), ('${MATTIAS}', 'm@example.test'), ('${NILS}', 'n@example.test')`)
  for (const [id, name, handle] of [[JARN, 'Järnmannen', 'jarnmannen'], [LOTTA, 'Lotta', 'lotta_g'], [MATTIAS, 'Mattias', 'mattias']] as const) {
    await as(db, 'authenticated', id, () => db.query('insert into public.profiles (id, display_name, handle) values ($1, $2, $3)', [id, name, handle]))
  }
  for (const id of [JARN, LOTTA]) await as(db, 'authenticated', id, () => db.query(`select public.publish_post('Hej från läktaren')`))
})

const follow = (id: string) => db.query<{ ok: boolean }>('select public.follow_supporter($1) as ok', [id])
const unfollow = (id: string) => db.query<{ removed: boolean }>('select public.unfollow_supporter($1) as removed', [id])
const list = async () => (await db.query<{ id: string, display_name: string, handle: string, avatar: string | null }>('select id, display_name, handle, avatar from public.followed_supporters()')).rows
const rows = async () => (await db.query<{ follower_id: string, followed_id: string }>('select follower_id, followed_id from public.supporter_follows order by followed_id')).rows
const allRows = async () => (await db.query<{ follower_id: string, followed_id: string }>('select follower_id, followed_id from public.supporter_follows order by follower_id, followed_id')).rows

describe('following', () => {
  it('a supporter with a profile follows a public supporter, and sees them in their own list', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      expect((await follow(JARN)).rows[0]!.ok).toBe(true)
      expect(await list()).toEqual([{ id: JARN, display_name: 'Järnmannen', handle: 'jarnmannen', avatar: null }])
      expect(await rows()).toEqual([{ follower_id: MATTIAS, followed_id: JARN }])
    })
  })

  it('following again is safe: still one follow', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      await follow(JARN)
      expect((await follow(JARN)).rows[0]!.ok).toBe(true)
      expect(await rows()).toHaveLength(1)
      // Even a direct second insert can't make a duplicate
      expect(await codeOf(db.query('insert into public.supporter_follows (followed_id) values ($1)', [JARN]))).toBe('23505')
    })
  })

  it('unfollowing removes it, and doing it again is harmless', async () => {
    await as(db, 'authenticated', MATTIAS, async () => {
      await follow(JARN)
      expect((await unfollow(JARN)).rows[0]!.removed).toBe(true)
      expect((await unfollow(JARN)).rows[0]!.removed).toBe(false)
      expect(await list()).toEqual([])
    })
  })

  it('nobody follows themself', async () => {
    await as(db, 'authenticated', JARN, async () => {
      expect(await codeOf(follow(JARN))).toBe('23514')
      expect(await codeOf(db.query('insert into public.supporter_follows (followed_id) values ($1)', [JARN]))).toBe('23514')
    })
  })
})

describe('only public supporters, and no probing', () => {
  it('a private profile and a missing account give exactly the same answer', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      const privateOne = await db.query('select public.follow_supporter($1)', [MATTIAS]).catch((e: { code: string, message: string }) => e)
      const missing = await db.query('select public.follow_supporter($1)', [GHOST]).catch((e: { code: string, message: string }) => e)
      expect([(privateOne as { code: string }).code, (missing as { code: string }).code]).toEqual(['P0002', 'P0002'])
      expect((privateOne as { message: string }).message).toBe((missing as { message: string }).message)
      // Going round the function changes nothing: the same refusal for both
      expect(await codeOf(db.query('insert into public.supporter_follows (followed_id) values ($1)', [MATTIAS]))).toBe('42501')
      expect(await codeOf(db.query('insert into public.supporter_follows (followed_id) values ($1)', [GHOST]))).toBe('42501')
      expect(await rows()).toEqual([])
    })
  })

  it('a supporter becomes followable once their place is public (they comment)', async () => {
    await as(db, 'authenticated', LOTTA, async () => expect(await codeOf(follow(MATTIAS))).toBe('P0002'))
    await as(db, 'authenticated', MATTIAS, async () => {
      const post = (await db.query<{ id: string }>('select id from public.posts limit 1')).rows[0]!.id
      await db.query('insert into public.post_comments (post_id, body) values ($1, $2)', [post, 'Heja!'])
    })
    await as(db, 'authenticated', LOTTA, async () => expect((await follow(MATTIAS)).rows[0]!.ok).toBe(true))
  })

  it('signed in without a profile: can\'t follow (same rule as posting)', async () => {
    await as(db, 'authenticated', NILS, async () => {
      expect(await codeOf(follow(JARN))).toBe('42501')
      expect(await codeOf(db.query('insert into public.supporter_follows (followed_id) values ($1)', [JARN]))).toBe('42501')
    })
  })

  it('signed out: no access at all', async () => {
    await as(db, 'anon', null, async () => {
      expect(await codeOf(follow(JARN))).toBe('42501')
      expect(await codeOf(unfollow(JARN))).toBe('42501')
      expect(await codeOf(list())).toBe('42501')
      expect(await codeOf(db.query('select 1 from public.supporter_follows'))).toBe('42501')
    })
  })
})

describe('private: only the follower sees their follows', () => {
  beforeEach(async () => {
    await as(db, 'authenticated', MATTIAS, () => follow(JARN))
    await as(db, 'authenticated', LOTTA, () => follow(JARN))
  })

  it('the supporter being followed sees none of it, and nor does anyone else', async () => {
    await as(db, 'authenticated', JARN, async () => {
      expect(await rows()).toEqual([])
      expect(await list()).toEqual([])
    })
    await as(db, 'authenticated', LOTTA, async () => expect(await rows()).toEqual([{ follower_id: LOTTA, followed_id: JARN }]))
  })

  it('nobody can follow, or unfollow, on someone else\'s behalf', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      // follower_id isn't writable at all
      expect(await codeOf(db.query('insert into public.supporter_follows (follower_id, followed_id) values ($1, $2)', [MATTIAS, LOTTA]))).toBe('42501')
      // Deleting reaches only your own rows: Mattias's follow survives
      await db.query('delete from public.supporter_follows')
      expect(await codeOf(db.query('update public.supporter_follows set followed_id = $1', [LOTTA]))).toBe('42501')
    })
    expect(await allRows()).toEqual([{ follower_id: MATTIAS, followed_id: JARN }])
  })
})

describe('over time', () => {
  it('a handle change keeps the follow (it\'s by user id)', async () => {
    await as(db, 'authenticated', MATTIAS, () => follow(JARN))
    await as(db, 'authenticated', JARN, () => db.query(`update public.profiles set handle = 'jarnkaminen' where id = $1`, [JARN]))
    await as(db, 'authenticated', MATTIAS, async () => expect((await list()).map(p => p.handle)).toEqual(['jarnkaminen']))
  })

  it('a supporter who becomes private disappears from the list, but can still be unfollowed', async () => {
    await as(db, 'authenticated', MATTIAS, () => follow(LOTTA))
    await as(db, 'authenticated', LOTTA, () => db.query('delete from public.posts where author_id = $1', [LOTTA]))
    await as(db, 'authenticated', MATTIAS, async () => {
      expect(await list()).toEqual([])
      // Not followable again while private
      expect(await codeOf(follow(LOTTA))).toBe('P0002')
      expect((await unfollow(LOTTA)).rows[0]!.removed).toBe(true)
    })
  })

  it('deleting an account removes its follows, both ways', async () => {
    await as(db, 'authenticated', MATTIAS, () => follow(JARN))
    await as(db, 'authenticated', JARN, () => follow(LOTTA))
    await db.exec(`delete from auth.users where id = '${JARN}'`)
    expect(await allRows()).toEqual([])
  })
})

describe('the migration', () => {
  it('leaves real supporters, posts and comments untouched', async () => {
    const d = await createSupabaseLikeDb({ stopBefore: '20261115010000_supporter_follows.sql' })
    await seedRealData(d)
    const before = await realDataSnapshot(d)
    await applyMigrations(d, { from: '20261115010000_supporter_follows.sql' })
    expect(await realDataSnapshot(d)).toEqual(before)
  })
})

describe('supabase/tests/follows_rls.test.sql', () => {
  it.each([false, true])('passes every assertion (with real data: %s), and leaves nothing behind', async (withRealData) => {
    const d = await createSupabaseLikeDb()
    if (withRealData) await seedRealData(d)
    const before = await realDataSnapshot(d)
    const { lines, planned } = await runPgTapFile(d, 'follows_rls.test.sql')
    expect(lines.filter(l => !l.startsWith('ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(d)).toEqual(before)
  })
})
