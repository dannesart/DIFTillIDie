import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FrozenStory, NewsResponse, Story } from '../shared/types/domain'
import { COLUMNS, toCommunityPost } from '../app/lib/posts'

/*
 * Real-API acceptance test for publishing with frozen Stories, against a
 * hosted Supabase project and the deployed site. Run AFTER the deployment
 * steps in docs/snacket-posts.md ("Deploying"):
 *
 *   ACCEPT_SUPABASE_URL=https://<ref>.supabase.co
 *   ACCEPT_SUPABASE_KEY=sb_publishable_...        (the publishable key, nothing secret)
 *   ACCEPT_ACCESS_TOKEN=<a test supporter's access token; they need a profile>
 *   ACCEPT_SITE_URL=https://<deployed site>       (signs Story captures)
 *   npm run test:acceptance
 *
 * The signed captures come from the site's own /api/news, so this checks
 * the whole chain (server key, Vault key, function, PostgREST) without the
 * test ever holding the signing key. Every post it makes is deleted again
 * at the end (it's the test supporter's own). Skipped in `npm test`.
 */
const run = process.env.npm_lifecycle_event === 'test:acceptance'
const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`Set ${k} (see tests/acceptance-publish.test.ts)`)
  return v
}

describe.runIf(run)('publish_post through the real Data API', () => {
  let anon: SupabaseClient
  let me: SupabaseClient
  let story: Story
  const made: string[] = []
  let myId = ''

  beforeAll(async () => {
    const url = env('ACCEPT_SUPABASE_URL')
    const key = env('ACCEPT_SUPABASE_KEY')
    const auth = { persistSession: false, autoRefreshToken: false }
    anon = createClient(url, key, { auth })
    me = createClient(url, key, { auth, global: { headers: { Authorization: `Bearer ${env('ACCEPT_ACCESS_TOKEN')}` } } })
    const news = await (await fetch(new URL('/api/news', env('ACCEPT_SITE_URL')))).json() as NewsResponse
    const signed = news.stories.find(s => s.capture)
    if (!signed) throw new Error('The site serves no signed Stories: is NUXT_STORY_CAPTURE_KEY(_ID) set there?')
    story = signed
  })

  afterAll(async () => {
    if (made.length) await me.from('posts').delete().in('id', made)
  })

  const publish = (client: SupabaseClient, body: string, story?: { data?: string | null, sig?: string | null }) =>
    client.rpc('publish_post', { p_body: body, p_sport: null, p_story: story?.data ?? null, p_story_sig: story?.sig ?? null }).select(COLUMNS).single()
  const stamp = () => `Acceptanstest ${new Date().toISOString()}`

  it('the feed query works for anyone, story_ref included', async () => {
    const { error } = await anon.from('posts').select(COLUMNS).limit(1)
    expect(error).toBeNull()
  })

  it('visitors cannot publish', async () => {
    const { data, error } = await publish(anon, stamp())
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('a post without a Story: one object, author embedded, no Story', async () => {
    const { data, error } = await publish(me, stamp())
    expect(error).toBeNull()
    made.push((data as { id: string }).id)
    myId = (data as { author: { id: string } }).author.id
    expect(data).toEqual({
      id: expect.any(String), body: expect.stringMatching(/^Acceptanstest/), sport: null, story_id: null, story_ref: null,
      created_at: expect.any(String), author: { id: expect.any(String), display_name: expect.any(String), handle: expect.any(String) },
    })
    expect(toCommunityPost(data as never)).not.toBeNull()
  })

  it('a signed Story: frozen exactly as the site signed it', async () => {
    const { data, error } = await publish(me, stamp(), story.capture)
    expect(error).toBeNull()
    const row = data as { id: string, story_id: string, story_ref: FrozenStory }
    made.push(row.id)
    expect(row.story_ref).toEqual(JSON.parse(story.capture!.data))
    expect(row.story_id).toBe(row.story_ref.storyId)
    expect(toCommunityPost(data as never)?.storyRef?.sources.length).toBe(row.story_ref.sources.length)
  })

  it('an edited capture, an unsigned capture or a wrong signature: refused, nothing published', async () => {
    // Counting only the test supporter's own posts: others may be posting meanwhile.
    const mine = () => me.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', myId)
    const before = await mine()
    const frozen = JSON.parse(story.capture!.data) as FrozenStory
    frozen.sources[0]!.headline = 'Djurgården köper Messi'
    for (const bad of [
      { data: JSON.stringify(frozen), sig: story.capture!.sig },
      { data: story.capture!.data, sig: null },
      { data: story.capture!.data, sig: '0'.repeat(64) },
    ]) {
      const { data, error } = await publish(me, stamp(), bad)
      expect(data).toBeNull()
      expect(error?.code).toBe('22023')
    }
    const after = await mine()
    expect(after.count).toBe(before.count)
  })

  it('direct inserts are closed (after the second migration)', async () => {
    const { error } = await me.from('posts').insert({ body: stamp() }).select('id')
    expect(error?.code).toBe('42501')
  })

  it('visitors read the published posts with the author’s public name and the frozen Story', async () => {
    const { data, error } = await anon.from('posts').select(COLUMNS).in('id', made)
    expect(error).toBeNull()
    const posts = (data ?? []).map(r => toCommunityPost(r as never))
    expect(posts).toHaveLength(2)
    expect(posts.every(p => p?.author.handle)).toBe(true)
    expect(posts.filter(p => p?.storyRef).length).toBe(1)
  })
})
