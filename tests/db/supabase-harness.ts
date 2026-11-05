import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

/*
 * A small, local stand-in for a Supabase database so the real migration files
 * and their RLS policies can be exercised in tests — without touching the
 * hosted project. It recreates what the migrations depend on:
 *  - the anon / authenticated / service_role roles (service_role bypasses RLS),
 *  - auth.users and auth.uid() (same definition as Supabase: JWT "sub" claim),
 *  - Supabase's default privileges, which grant ALL on new public tables to
 *    anon and authenticated — so the migrations' explicit revokes are tested,
 *  - the `extensions` schema (pgcrypto) and a stand-in for Vault's
 *    decrypted_secrets / create_secret, readable only by the owner.
 * It is not Supabase itself; supabase/tests/*.sql runs against the real thing.
 */

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))

/*
 * Setting up and migrating takes seconds, so each test file does it once
 * per starting point and every test gets a fresh copy of that data dir.
 */
const templates = new Map<string, Promise<File | Blob>>()

/** `stopBefore`: leave that migration and later ones for applyMigrations(), e.g. to seed older rows first. */
export async function createSupabaseLikeDb(opts: { stopBefore?: string } = {}): Promise<PGlite> {
  const id = opts.stopBefore ?? ''
  if (!templates.has(id)) {
    templates.set(id, (async () => {
      const db = await buildDb(opts)
      const dump = await db.dumpDataDir('none')
      await db.close()
      return dump
    })())
  }
  return PGlite.create({ extensions: { pgcrypto }, loadDataDir: await templates.get(id)! })
}

async function buildDb(opts: { stopBefore?: string }) {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;

    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

    create schema extensions;
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text not null);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null) returns uuid language sql as $$
      insert into vault.secrets (name, secret) values (new_name, new_secret) returning id
    $$;
  `)
  await applyMigrations(db, { until: opts.stopBefore })
  return db
}

/** Run the migrations (from `from`, before `until`), in order. */
export async function applyMigrations(db: PGlite, range: { from?: string, until?: string } = {}) {
  for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    if (range.from && file < range.from) continue
    if (range.until && file >= range.until) continue
    await db.exec(readFileSync(`${migrationsDir}${file}`, 'utf8'))
  }
}

export type Db = Awaited<ReturnType<typeof createSupabaseLikeDb>>

/** Run queries as a Supabase API role; `sub` makes it a specific signed-in user. */
export async function as<T>(db: Db, role: 'anon' | 'authenticated' | 'service_role', sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [sub ? JSON.stringify({ sub, role }) : JSON.stringify({ role })])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  }
  finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

/**
 * Data a hosted database already has: a real supporter with a profile and a
 * published post. The pgTAP suites must pass around it and leave it alone.
 */
export const REAL_SUPPORTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export async function seedRealData(db: Db) {
  await db.exec(`
    insert into auth.users (id, email) values ('${REAL_SUPPORTER}', 'jarnmannen@example.test');
    insert into public.profiles (id, display_name, handle) values ('${REAL_SUPPORTER}', 'Järnmannen', 'jarnmannen');
    insert into public.posts (author_id, body) values ('${REAL_SUPPORTER}', 'Första riktiga inlägget! 💙');
  `)
}
export async function realDataSnapshot(db: Db) {
  const users = await db.query<{ id: string }>('select id from auth.users order by id')
  const profiles = await db.query('select id, display_name, handle from public.profiles order by id')
  const posts = await db.query('select author_id, body from public.posts order by body')
  const comments = await db.query('select author_id, body from public.post_comments order by body')
  return { users: users.rows.map(r => r.id), profiles: profiles.rows, posts: posts.rows, comments: comments.rows }
}

/** The Postgres error code of a failed query (e.g. 42501 permission denied), or 'ok'. */
export async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  }
  catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}
