import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrozenStory, SourceArticle, Story, StoryCapture } from '../shared/types/domain'
import { toCommunityPost } from '../app/lib/posts'
import { captureStory, signCapture } from '../server/lib/capture'
import { articleId, articleKey, legacyArticleId } from '../server/lib/news'
import type { Db } from './db/supabase-harness'
import { runPgTapFile } from './db/pgtap-shim'
import { applyMigrations, as, codeOf, createSupabaseLikeDb, realDataSnapshot, seedRealData } from './db/supabase-harness'

/*
 * Durable Story references: a post freezes the Story it's about, as our
 * server captured and signed it, in the same transaction as the post.
 * Codes: 22023 capture not verified, 42501 not allowed, 23514 rule broken.
 */

const HASSE = '22222222-2222-4222-8222-222222222222'
const LOTTA = '11111111-1111-4111-8111-111111111111'
const KEY = { kid: 'k1', secret: 'test-secret-not-for-production' }
const MIGRATION = '20261105090000_post_story_refs.sql'

function art(url: string, headline: string, outlet = 'Sportbladet', publisher = 'Aftonbladet'): SourceArticle {
  return {
    id: articleId(publisher, url), legacyId: legacyArticleId(publisher, url), sourceId: `${outlet.toLowerCase()}-fotboll`,
    outlet, publisher, headline, url, publishedAt: '2026-11-04T18:00:00.000Z', sport: 'fotboll', reporting: 'original',
  }
}
const A = art('https://www.aftonbladet.se/sportbladet/fotboll/a/1/derby', 'Derbyt avgjort: ”Vilken kväll på Tele2” 💙')
const B = art('https://www.expressen.se/sport/fotboll/derby-2', 'Djurgården vann derbyt – så var matchen', 'Expressen', 'Expressen')
const C = art('https://bollsvenskan.se/nyhetsflode/?post_id=3', 'Sammanfattning: derbyt', 'Bollsvenskan', 'Bollsvenskan')
const story = (sources: SourceArticle[]): Story => ({ id: `story-${sources[0]!.id}`, sport: 'fotboll', sources, leadId: sources[0]!.id, sharedNames: [], updatedAt: '2026-11-04T19:00:00.000Z' })
const FEEDS = [{ id: 'sportbladet-fotboll', fetchedAt: '2026-11-04T18:05:00.000Z' }, { id: 'expressen-fotboll', fetchedAt: '2026-11-04T18:10:00.000Z' }]

let db: Db

beforeEach(async () => {
  db = await createSupabaseLikeDb()
  await db.exec(`insert into auth.users (id, email) values ('${HASSE}', 'h@example.test'), ('${LOTTA}', 'l@example.test')`)
  for (const [id, name, handle] of [[HASSE, 'Hovet-Hasse', 'hovethasse'], [LOTTA, 'Lotta', 'lotta_g']] as const) {
    await as(db, 'authenticated', id, () => db.query('insert into public.profiles (id, display_name, handle) values ($1, $2, $3)', [id, name, handle]))
  }
  await db.query(`select vault.create_secret($1, 'story_capture_key:' || $2)`, [KEY.secret, KEY.kid])
})

const publish = (body: string, capture?: Partial<StoryCapture>, who = HASSE) => as(db, 'authenticated', who, () =>
  db.query<{ id: string, author_id: string, story_id: string | null, story_ref: FrozenStory | null }>(
    'select id, author_id, story_id, story_ref from public.publish_post($1, null, $2, $3)', [body, capture?.data ?? null, capture?.sig ?? null]))
const count = async () => (await db.query<{ n: number }>('select count(*)::int as n from public.posts')).rows[0]!.n
/** A capture our server would sign, with the JSON changed first. */
const signed = (frozen: object): StoryCapture => {
  const data = JSON.stringify(frozen)
  return { data, sig: signCapture(data, KEY.secret) }
}

describe('publishing with a Story', () => {
  it('freezes exactly the Story our server signed, in the post itself', async () => {
    const cap = captureStory(story([A, B]), KEY, FEEDS)
    const { rows: [post] } = await publish('Vilket derby! #dif', cap)
    expect(post).toMatchObject({ author_id: HASSE, story_id: `story-${A.id}`, story_ref: JSON.parse(cap.data) })
    expect(post!.story_ref!.sources.map(s => [s.outlet, s.headline, s.url, s.key])).toEqual([
      ['Sportbladet', A.headline, A.url, articleKey(A.url)],
      ['Expressen', B.headline, B.url, articleKey(B.url)],
    ])
    // Anyone can read it, signed in or not.
    const seen = await as(db, 'anon', null, () => db.query<{ story_ref: FrozenStory }>('select story_ref from public.posts'))
    expect(seen.rows[0]!.story_ref.sources[1]!.capturedAt).toBe('2026-11-04T18:10:00.000Z')
  })

  it('Node and Postgres agree on the signature over Swedish, typographic quotes and emoji', async () => {
    const cap = captureStory(story([art('https://example.se/å', 'Ålänningen öppnar: ”Härligt” – 💙❤️💛')]), KEY, FEEDS)
    expect((await db.query<{ sig: string }>(`select encode(extensions.hmac($1, $2, 'sha256'), 'hex') as sig`, [cap.data, KEY.secret])).rows[0]!.sig).toBe(cap.sig)
    expect(await codeOf(publish('Heja', cap))).toBe('ok')
  })

  it('a big Story whose lead is past the 20-source limit still attaches, lead included', async () => {
    const many = Array.from({ length: 25 }, (_, i) => art(`https://e.se/many/${i}`, `Rubrik ${i}`))
    const big = { ...story(many), leadId: many[24]!.id }
    const { rows: [post] } = await publish('Stor Story', captureStory(big, KEY, FEEDS))
    const ref = post!.story_ref!
    expect([ref.sources.length, ref.sources.find(s => s.key === ref.leadKey)?.headline]).toEqual([20, 'Rubrik 24'])
  })

  it('without a Story, as before', async () => {
    const { rows: [post] } = await publish('Bara snack')
    expect(post).toMatchObject({ story_id: null, story_ref: null })
  })
})

describe('forged references are refused, and then nothing is published', () => {
  const cap = () => captureStory(story([A, B]), KEY, FEEDS)

  it('an edited headline, URL, outlet or source list', async () => {
    const good = cap()
    const frozen = JSON.parse(good.data) as FrozenStory
    const edits: ((f: FrozenStory) => void)[] = [
      f => (f.sources[0]!.headline = 'Djurgården köper Messi'),
      f => (f.sources[0]!.url = 'https://evil.example/phish'),
      f => (f.sources[1]!.outlet = 'Dagens Nyheter'),
      f => f.sources.push(JSON.parse(JSON.stringify(f.sources[0]))),
      f => f.sources.pop(),
      f => (f.storyId = 'story-something-else'),
    ]
    for (const edit of edits) {
      const f = structuredClone(frozen)
      edit(f)
      expect(await codeOf(publish('Fejk', { data: JSON.stringify(f), sig: good.sig }))).toBe('22023')
    }
    // Same content, re-serialised: still refused, the signature covers the exact text.
    expect(await codeOf(publish('Fejk', { data: JSON.stringify(frozen, null, 1), sig: good.sig }))).toBe('22023')
    expect(await count()).toBe(0)
  })

  it('a missing, wrong or foreign signature, or an unknown key', async () => {
    const good = cap()
    for (const bad of [
      { data: good.data },
      { sig: good.sig },
      { data: good.data, sig: '0'.repeat(64) },
      { data: good.data, sig: signCapture(good.data, 'a guessed secret') },
      { data: good.data, sig: captureStory(story([C]), KEY, FEEDS).sig },
      captureStory(story([A]), { kid: 'unknown', secret: KEY.secret }, FEEDS),
      { data: 'not json', sig: signCapture('not json', KEY.secret) },
      { data: '[1,2]', sig: signCapture('[1,2]', KEY.secret) },
    ]) {
      expect(await codeOf(publish('Fejk', bad)), JSON.stringify(bad).slice(0, 80)).toBe('22023')
    }
    expect(await count()).toBe(0)
  })

  it('even correctly signed, a malformed capture is not frozen', async () => {
    const frozen = JSON.parse(cap().data) as FrozenStory
    const broken: ((f: FrozenStory) => void)[] = [
      f => (f.leadKey = 'f'.repeat(64)),
      f => (f.sources = []),
      f => (f.sources = Array.from({ length: 21 }, () => f.sources[0]!)),
      f => (f.sources[0]!.url = 'javascript:alert(1)'),
      f => (f.sources[0]!.key = 'short'),
      f => (f.sources[0]!.headline = ''),
      f => (f.storyId = 'story with spaces'),
      f => ((f as { v: number }).v = 2),
    ]
    for (const b of broken) {
      const f = structuredClone(frozen)
      b(f)
      expect(await codeOf(publish('Trasig', signed(f)))).toBe('22023')
    }
    expect(await count()).toBe(0)
  })

  it('the frozen Story can never be written or changed directly, not even by the author', async () => {
    const { rows: [post] } = await publish('Mitt', cap())
    await as(db, 'authenticated', HASSE, async () => {
      expect(await codeOf(db.query(`update public.posts set story_ref = '{}'::jsonb where id = $1`, [post!.id]))).toBe('42501')
      expect(await codeOf(db.query(`insert into public.posts (body, story_id, story_ref) values ('x', 'story-x', '{"storyId":"story-x"}')`))).toBe('42501')
    })
    await as(db, 'anon', null, async () => {
      expect(await codeOf(db.query(`select public.publish_post('x', null, $1, $2)`, [cap().data, cap().sig]))).toBe('42501')
    })
  })

  it('a capture doesn’t make you someone else: the author is still the session', async () => {
    const { rows: [post] } = await publish('Lottas', cap(), LOTTA)
    expect(post!.author_id).toBe(LOTTA)
  })

  it('the signing key itself is out of reach for supporters and visitors', async () => {
    for (const [role, who] of [['authenticated', HASSE], ['anon', null]] as const) {
      await as(db, role, who, async () => {
        expect(await codeOf(db.query('select decrypted_secret from vault.decrypted_secrets'))).toBe('42501')
      })
    }
  })
})

describe('Stories change; frozen references don’t', () => {
  it('a later grouping with more sources doesn’t reach an earlier post', async () => {
    const before = captureStory(story([A, B]), KEY, FEEDS)
    const after = captureStory(story([A, B, C]), KEY, FEEDS)
    expect(JSON.parse(before.data).storyId).toBe(JSON.parse(after.data).storyId)
    const { rows: [first] } = await publish('Tidigt', before)
    const { rows: [second] } = await publish('Senare', after)
    const refs = await db.query<{ id: string, n: number }>(`select id, jsonb_array_length(story_ref -> 'sources') as n from public.posts`)
    expect(Object.fromEntries(refs.rows.map(r => [r.id, r.n]))).toEqual({ [first!.id]: 2, [second!.id]: 3 })
  })

  it('a source dropping out of the Story later doesn’t either', async () => {
    const { rows: [post] } = await publish('Tidigt', captureStory(story([A, B, C]), KEY, FEEDS))
    await publish('Senare', captureStory(story([A]), KEY, FEEDS))
    const { rows } = await db.query<{ n: number }>(`select jsonb_array_length(story_ref -> 'sources') as n from public.posts where id = $1`, [post!.id])
    expect(rows[0]!.n).toBe(3)
  })

  it('a rotated key: captures signed with either live key are accepted', async () => {
    await db.query(`select vault.create_secret('second-secret', 'story_capture_key:k2')`)
    expect(await codeOf(publish('Gammal nyckel', captureStory(story([A]), KEY, FEEDS)))).toBe('ok')
    expect(await codeOf(publish('Ny nyckel', captureStory(story([A]), { kid: 'k2', secret: 'second-secret' }, FEEDS)))).toBe('ok')
  })
})

describe('when capturing isn’t possible', () => {
  it('no key in Vault: the Story is refused and the post isn’t half-published', async () => {
    await db.exec(`delete from vault.secrets`)
    expect(await codeOf(publish('Med Story', captureStory(story([A]), KEY, FEEDS)))).toBe('22023')
    expect(await count()).toBe(0)
    // Without the Story, publishing works: the supporter decides.
    expect(await codeOf(publish('Utan Story'))).toBe('ok')
  })

  it('a valid capture with a post that breaks the rules: neither is written', async () => {
    expect(await codeOf(publish(' ', captureStory(story([A]), KEY, FEEDS)))).toBe('23514')
    expect(await count()).toBe(0)
  })
})

describe('posts from before this migration', () => {
  it('keep their bare story_id, untouched and honest: no frozen Story is made up', async () => {
    const old = await createSupabaseLikeDb({ stopBefore: MIGRATION })
    await old.exec(`insert into auth.users (id) values ('${HASSE}')`)
    await as(old, 'authenticated', HASSE, async () => {
      await old.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Hasse', 'hovethasse')`, [HASSE])
      // The old way of publishing, with a legacy (32-bit) Story id.
      await old.query(`insert into public.posts (body, story_id) values ('Gammalt inlägg', $1)`, [`story-${A.legacyId}`])
      await old.query(`insert into public.posts (body) values ('Gammalt utan Story')`)
    })
    await applyMigrations(old, { from: MIGRATION })
    const { rows } = await as(old, 'anon', null, () => old.query('select body, story_id, story_ref from public.posts order by body'))
    expect(rows).toEqual([
      { body: 'Gammalt inlägg', story_id: `story-${A.legacyId}`, story_ref: null },
      { body: 'Gammalt utan Story', story_id: null, story_ref: null },
    ])
    // And they stay that way: nobody can attach a frozen Story afterwards.
    await as(old, 'authenticated', HASSE, async () => {
      expect(await codeOf(old.query(`update public.posts set story_ref = '{}'::jsonb`))).toBe('42501')
    })
    // A new post can't take that shortcut: a Story without a frozen reference is refused outright.
    expect(await codeOf(old.query(`insert into public.posts (author_id, body, story_id) values ($1, 'Ny', 'story-x')`, [HASSE]))).toBe('23514')
    await old.close()
  })
})

describe('the response the app gets through PostgREST', () => {
  /*
   * What PostgREST (v12) runs for the app's call,
   *   rpc('publish_post', args).select(POST_COLUMNS).single(),
   * reduced to its shape: the function in a CTE, the author embedded with a
   * lateral join through posts_author_id_fkey, all in ONE statement and as
   * the caller's role. That's where a first-time poster could come back
   * without an author (the "has posted" policy can't see a row inserted in
   * the same statement); the own-profile policy is what makes it visible.
   */
  const PGRST_CALL = `
    with pgrst_source as (
      select pgrst_call.* from public.publish_post(p_body := $1, p_sport := $2, p_story := $3, p_story_sig := $4) pgrst_call
    )
    select coalesce((json_agg(t) -> 0)::text, 'null') as body
    from (
      select s.id, s.body, s.sport, s.story_id, s.story_ref, s.created_at, row_to_json(a.*)::jsonb as author
      from pgrst_source s
      left join lateral (
        select p.id, p.display_name, p.handle from public.profiles p where p.id = s.author_id
      ) a on true
    ) t`

  it('a first-time poster gets the post back with its author and frozen Story, as the app reads it', async () => {
    const cap = captureStory(story([A, B]), KEY, FEEDS)
    const { rows } = await as(db, 'authenticated', LOTTA, () => db.query<{ body: string }>(PGRST_CALL, ['Första gången', 'fotboll', cap.data, cap.sig]))
    const json = JSON.parse(rows[0]!.body)
    expect(json).toEqual({
      id: expect.any(String), body: 'Första gången', sport: 'fotboll', story_id: `story-${A.id}`,
      story_ref: JSON.parse(cap.data), created_at: expect.any(String),
      author: { id: LOTTA, display_name: 'Lotta', handle: 'lotta_g' },
    })
    const post = toCommunityPost(json)
    expect(post).toMatchObject({ author: { id: LOTTA, name: 'Lotta', handle: 'lotta_g' }, storyId: `story-${A.id}`, storyRef: JSON.parse(cap.data) })
  })

  it('without a Story: the same shape, story fields null', async () => {
    const { rows } = await as(db, 'authenticated', HASSE, () => db.query<{ body: string }>(PGRST_CALL, ['Bara snack', null, null, null]))
    expect(toCommunityPost(JSON.parse(rows[0]!.body))).toMatchObject({ storyId: undefined, storyRef: undefined, author: { handle: 'hovethasse' } })
  })

  it('anyone then reads it, with the author and the frozen Story, through the feed query', async () => {
    const cap = captureStory(story([A]), KEY, FEEDS)
    await as(db, 'authenticated', LOTTA, () => db.query(PGRST_CALL, ['Läs mig', null, cap.data, cap.sig]))
    const { rows } = await as(db, 'anon', null, () => db.query<{ handle: string, story_ref: FrozenStory }>(
      `select p.story_ref, a.handle from public.posts p left join lateral (select handle from public.profiles where id = p.author_id) a on true`))
    expect(rows).toEqual([{ handle: 'lotta_g', story_ref: JSON.parse(cap.data) }])
  })
})

describe('deploying in two steps, and recovering', () => {
  const CLOSE = '20261105090100_close_direct_post_inserts.sql'
  const oldWay = (d: Db, body: string, storyId: string | null = null) =>
    as(d, 'authenticated', HASSE, () => d.query(`insert into public.posts (body, story_id) values ($1, $2)`, [body, storyId]))
  const newWay = (d: Db, body: string, cap?: StoryCapture) =>
    as(d, 'authenticated', HASSE, () => d.query('select id from public.publish_post($1, null, $2, $3)', [body, cap?.data ?? null, cap?.sig ?? null]))
  async function withHasse(d: Db) {
    await d.exec(`insert into auth.users (id) values ('${HASSE}')`)
    await as(d, 'authenticated', HASSE, () => d.query(`insert into public.profiles (id, display_name, handle) values ($1, 'Hasse', 'hovethasse')`, [HASSE]))
    await d.query(`select vault.create_secret($1, 'story_capture_key:' || $2)`, [KEY.secret, KEY.kid])
  }

  it('step 1 only adds: the live (old) app keeps publishing, the new app already can', async () => {
    const d = await createSupabaseLikeDb({ stopBefore: CLOSE })
    await withHasse(d)
    expect(await codeOf(oldWay(d, 'Gamla appen', `story-${A.legacyId}`))).toBe('ok')
    expect(await codeOf(newWay(d, 'Nya appen', captureStory(story([A]), KEY, FEEDS)))).toBe('ok')
    // The old path can never write a frozen Story.
    expect(await codeOf(as(d, 'authenticated', HASSE, () => d.query(`insert into public.posts (body, story_id, story_ref) values ('x', 'story-x', '{"storyId":"story-x"}')`)))).toBe('42501')
    await d.close()
  })

  it('step 2 closes the old path; the recovery script reopens it without touching any post', async () => {
    const d = await createSupabaseLikeDb()
    await withHasse(d)
    await newWay(d, 'Med Story', captureStory(story([A, B]), KEY, FEEDS))
    expect(await codeOf(oldWay(d, 'Gamla appen'))).toBe('42501')
    const before = (await d.query('select body, story_id, story_ref from public.posts order by body')).rows
    await d.exec(readFileSync(fileURLToPath(new URL('../supabase/rollback/20261105090100_close_direct_post_inserts.down.sql', import.meta.url)), 'utf8'))
    expect((await d.query('select body, story_id, story_ref from public.posts order by body')).rows).toEqual(before)
    // The rolled-back app publishes again, Story or not; the new app still works too.
    expect(await codeOf(oldWay(d, 'Gamla appen igen', `story-${A.legacyId}`))).toBe('ok')
    expect(await codeOf(newWay(d, 'Nya appen igen', captureStory(story([A]), KEY, FEEDS)))).toBe('ok')
    // Re-applying step 2 afterwards works and closes it again.
    await d.exec(readFileSync(fileURLToPath(new URL(`../supabase/migrations/${CLOSE}`, import.meta.url)), 'utf8'))
    expect(await codeOf(oldWay(d, 'Stängt igen'))).toBe('42501')
    await d.close()
  })
})

describe('the pgTAP suite for the real database (supabase/tests)', () => {
  it.each([['an empty database', false], ['a database with a real supporter and post', true]])('runs green against %s', async (_label, withRealData) => {
    await db.exec('delete from auth.users; delete from vault.secrets')
    if (withRealData) await seedRealData(db)
    const before = await realDataSnapshot(db)
    const { lines, planned } = await runPgTapFile(db, 'story_refs_rls.test.sql')
    expect(lines.filter(l => l.startsWith('not ok'))).toEqual([])
    expect(lines).toHaveLength(planned)
    expect(await realDataSnapshot(db)).toEqual(before)
    expect((await db.query('select name from vault.secrets')).rows).toEqual([])
  })
})
