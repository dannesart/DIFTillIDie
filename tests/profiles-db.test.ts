import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { RESERVED_HANDLES } from '../shared/utils/profile'
import type { Db } from './db/supabase-harness'
import { as, codeOf, createSupabaseLikeDb } from './db/supabase-harness'

/*
 * Database authorization for public.profiles, with two distinct users.
 * Runs the real migration in a local Postgres (PGlite) that mimics Supabase's
 * roles and auth.uid(). Codes: 42501 permission denied (grant or RLS),
 * 23505 unique violation, 23514 check violation.
 */

const LOTTA = '11111111-1111-4111-8111-111111111111'
const HASSE = '22222222-2222-4222-8222-222222222222'

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${LOTTA}', 'lotta@example.test'), ('${HASSE}', 'hasse@example.test')`)
})

const insertOwn = (id: string, name: string, handle: string) =>
  db.query('insert into public.profiles (id, display_name, handle) values ($1, $2, $3)', [id, name, handle])

describe('anonymous visitors', () => {
  it('cannot read, create, update or delete profiles', async () => {
    await as(db, 'authenticated', LOTTA, () => insertOwn(LOTTA, 'Lotta', 'lotta'))
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query('select * from public.profiles'))).toBe('42501')
      expect(await codeOf(insertOwn(LOTTA, 'Anon', 'anon_user'))).toBe('42501')
      expect(await codeOf(db.query(`update public.profiles set display_name = 'Hackad'`))).toBe('42501')
      expect(await codeOf(db.query('delete from public.profiles'))).toBe('42501')
    })
  })
})

describe('own profile', () => {
  it('a supporter can create, read and update their own profile', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(insertOwn(LOTTA, 'Lotta från Gärdet', 'kaminen81'))).toBe('ok')
      expect((await db.query('select display_name, handle from public.profiles')).rows).toEqual([{ display_name: 'Lotta från Gärdet', handle: 'kaminen81' }])
      const r = await db.query(`update public.profiles set display_name = 'Lotta', handle = 'lotta_g' where id = $1`, [LOTTA])
      expect(r.affectedRows).toBe(1)
    })
    const row = (await db.query<{ display_name: string, handle: string }>('select display_name, handle from public.profiles')).rows[0]
    expect(row).toEqual({ display_name: 'Lotta', handle: 'lotta_g' })
  })

  it('updated_at is set by the database, not the client', async () => {
    await as(db, 'authenticated', LOTTA, () => insertOwn(LOTTA, 'Lotta', 'lotta'))
    await db.exec(`update public.profiles set updated_at = '2000-01-01' where id = '${LOTTA}'`) // as owner, to have a baseline
    await as(db, 'authenticated', LOTTA, () => db.query(`update public.profiles set display_name = 'Lotta G' where id = $1`, [LOTTA]))
    const { rows } = await db.query<{ fresh: boolean }>(`select updated_at > now() - interval '1 minute' as fresh from public.profiles`)
    expect(rows[0]!.fresh).toBe(true)
  })

  it('cannot change id or timestamps, and cannot delete', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      await insertOwn(LOTTA, 'Lotta', 'lotta')
      expect(await codeOf(db.query(`update public.profiles set id = $1 where id = $2`, [HASSE, LOTTA]))).toBe('42501')
      expect(await codeOf(db.query(`update public.profiles set created_at = now() - interval '10 years'`))).toBe('42501')
      expect(await codeOf(db.query(`update public.profiles set updated_at = now()`))).toBe('42501')
      expect(await codeOf(db.query('insert into public.profiles (id, display_name, handle, created_at) values ($1, $2, $3, now())', [LOTTA, 'X', 'xx_y']))).toBe('42501')
      expect(await codeOf(db.query('delete from public.profiles where id = $1', [LOTTA]))).toBe('42501')
    })
  })
})

describe('someone else’s profile', () => {
  beforeEach(async () => {
    await as(db, 'authenticated', HASSE, () => insertOwn(HASSE, 'Hovet-Hasse', 'hovethasse'))
  })

  it('cannot be read', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect((await db.query('select * from public.profiles')).rows).toEqual([])
      expect((await db.query('select * from public.profiles where id = $1', [HASSE])).rows).toEqual([])
    })
  })

  it('cannot be updated (RLS hides the row; nothing changes)', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      const r = await db.query(`update public.profiles set display_name = 'Hackad' where id = $1`, [HASSE])
      expect(r.affectedRows).toBe(0)
    })
    const { rows } = await db.query('select display_name from public.profiles where id = $1', [HASSE])
    expect(rows).toEqual([{ display_name: 'Hovet-Hasse' }])
  })

  it('an UPDATE without WHERE touches only your own row', async () => {
    // Without a WHERE clause Postgres skips SELECT policies, so this pins the
    // UPDATE policy's own USING clause.
    await as(db, 'authenticated', LOTTA, async () => {
      await insertOwn(LOTTA, 'Lotta', 'lotta')
      const r = await db.query(`update public.profiles set display_name = 'Alla heter Lotta'`)
      expect(r.affectedRows).toBe(1)
    })
    const { rows } = await db.query('select id, display_name from public.profiles order by display_name')
    expect(rows).toEqual([
      { id: LOTTA, display_name: 'Alla heter Lotta' },
      { id: HASSE, display_name: 'Hovet-Hasse' },
    ])
  })

  it('cannot be created on their behalf', async () => {
    await db.exec(`delete from public.profiles where id = '${HASSE}'`)
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(insertOwn(HASSE, 'Fake Hasse', 'fake_hasse'))).toBe('42501')
    })
  })

  it('cannot be taken over by moving your own row onto their id', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      await insertOwn(LOTTA, 'Lotta', 'lotta')
      expect(await codeOf(db.query(`update public.profiles set id = $1`, [HASSE]))).toBe('42501')
    })
  })

  it('cannot be deleted', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(db.query('delete from public.profiles where id = $1', [HASSE]))).toBe('42501')
    })
  })
})

describe('profile rules enforced by the database', () => {
  it('handles are unique (and lowercase, so case-insensitively unique)', async () => {
    await as(db, 'authenticated', HASSE, () => insertOwn(HASSE, 'Hasse', 'blarandig'))
    await as(db, 'authenticated', LOTTA, async () => {
      expect(await codeOf(insertOwn(LOTTA, 'Lotta', 'blarandig'))).toBe('23505')
      expect(await codeOf(insertOwn(LOTTA, 'Lotta', 'Blarandig'))).toBe('23514')
    })
  })

  it('rejects malformed and reserved handles and bad display names', async () => {
    await as(db, 'authenticated', LOTTA, async () => {
      for (const handle of ['ab', 'a'.repeat(21), 'med mellanslag', 'åäö', 'dif', 'admin', 'djurgarden']) {
        expect(await codeOf(insertOwn(LOTTA, 'Lotta', handle)), handle).toBe('23514')
      }
      for (const name of ['L', ' Lotta', 'Lotta ', 'x'.repeat(41), 'Lot\nta']) {
        expect(await codeOf(insertOwn(LOTTA, name, 'lotta')), JSON.stringify(name)).toBe('23514')
      }
      expect(await codeOf(insertOwn(LOTTA, 'Lotta från Gärdet', 'lotta_81'))).toBe('ok')
    })
  })

  it('a profile disappears with its account', async () => {
    await as(db, 'authenticated', LOTTA, () => insertOwn(LOTTA, 'Lotta', 'lotta'))
    await db.exec(`delete from auth.users where id = '${LOTTA}'`)
    expect((await db.query('select * from public.profiles')).rows).toEqual([])
  })
})

describe('grants', () => {
  it('anon has no privileges and authenticated only the intended ones', async () => {
    const { rows } = await db.query<{ grantee: string, privilege_type: string }>(`
      select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated', 'public')
      order by grantee, privilege_type`)
    expect(rows).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }])
    const cols = await db.query<{ privilege_type: string, column_name: string }>(`
      select privilege_type, column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
      order by privilege_type, column_name`)
    expect(cols.rows).toEqual([
      { privilege_type: 'INSERT', column_name: 'display_name' },
      { privilege_type: 'INSERT', column_name: 'handle' },
      { privilege_type: 'INSERT', column_name: 'id' },
      { privilege_type: 'UPDATE', column_name: 'display_name' },
      { privilege_type: 'UPDATE', column_name: 'handle' },
    ])
  })
})

describe('client rules match the database', () => {
  it('the reserved handle list is the same in TypeScript and SQL', () => {
    const sql = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261102180000_profiles.sql', import.meta.url)), 'utf8')
    const list = sql.match(/handle <> all \(array\[([\s\S]*?)\]\)/)![1]!.match(/'([^']+)'/g)!.map(s => s.slice(1, -1))
    expect([...list].sort()).toEqual([...RESERVED_HANDLES].sort())
  })
})

describe('the pgTAP suite for the real database (supabase/tests)', () => {
  it('runs green against the migration', async () => {
    const { PGTAP_SHIM } = await import('./db/pgtap-shim')
    await db.exec(PGTAP_SHIM)
    // The fixture users are created by the suite itself.
    await db.exec('delete from auth.users')
    const sql = readFileSync(fileURLToPath(new URL('../supabase/tests/profiles_rls.test.sql', import.meta.url)), 'utf8')
      .replace(/create extension if not exists pgtap[^;]*;/, '')
    const results = await db.exec(sql)
    const lines = results.flatMap(r => r.rows.flatMap(row => Object.values(row))).filter((v): v is string => typeof v === 'string' && /^(not )?ok - /.test(v))
    const planned = Number(sql.match(/select plan\((\d+)\)/)![1])
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    // Rolled back: nothing from the suite is left behind.
    expect((await db.query('select count(*)::int as n from auth.users')).rows).toEqual([{ n: 0 }])
  })
})
