import { describe, expect, it } from 'vitest'
import { LEGACY_KEY, readLegacyPosts, removeLegacyPost } from '../app/lib/legacyLocal'

/*
 * Old browser-local posts from before Snacket became real: read-only for
 * their writer, removable only on request, never otherwise touched.
 */

const ACCOUNT = 'account:11111111-1111-4111-8111-111111111111' as const

function memoryStorage(data: Record<string, string>) {
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v },
  }
}

// The exact shape the earlier app wrote.
const guestBucket = () => JSON.stringify({
  me: { name: 'Gästen', handle: 'gasten', flair: 'Ny på stan' },
  posts: [
    { id: 'mine-a', author: { name: 'Gästen', handle: 'gasten' }, body: 'Första', createdAt: '2026-11-01T10:00:00Z', sport: 'hockey', storyId: 'story-x', reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: [], demo: false },
    { id: 'mine-b', author: { name: 'Gästen', handle: 'gasten' }, body: 'Andra', createdAt: '2026-11-02T10:00:00Z', reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 }, comments: [], demo: false },
  ],
  reactions: { 'demo-1': ['hjarta'], 'mine-a': ['eld'] },
  comments: {
    'mine-a': [{ id: 'c1', author: { name: 'Gästen', handle: 'gasten' }, body: 'Egen kommentar', createdAt: '2026-11-01T11:00:00Z' }],
    'demo-1': [{ id: 'c2', author: { name: 'Gästen', handle: 'gasten' }, body: 'På ett påhittat inlägg', createdAt: '2026-11-01T12:00:00Z' }],
  },
})

describe('reading old local posts', () => {
  it('shows the owner’s posts newest first, with the local comments on them', () => {
    const posts = readLegacyPosts(memoryStorage({ [LEGACY_KEY]: guestBucket() }), 'guest')
    expect(posts.map(p => p.body)).toEqual(['Andra', 'Första'])
    expect(posts[1]).toMatchObject({ sport: 'hockey', storyId: 'story-x', comments: [{ authorName: 'Gästen', body: 'Egen kommentar' }] })
  })

  it('each owner sees only their own: the guest bucket is not an account’s, and vice versa', () => {
    const s = memoryStorage({ [LEGACY_KEY]: guestBucket() })
    expect(readLegacyPosts(s, ACCOUNT)).toEqual([])
    s.data[`${LEGACY_KEY}:${ACCOUNT}`] = JSON.stringify({ posts: [{ id: 'mine-z', body: 'Kontots', createdAt: '2026-11-03T10:00:00Z' }], reactions: {}, comments: {} })
    expect(readLegacyPosts(s, ACCOUNT).map(p => p.body)).toEqual(['Kontots'])
    expect(readLegacyPosts(s, 'guest').map(p => p.body)).toEqual(['Andra', 'Första'])
  })

  it('missing, empty or corrupt data shows nothing and is left exactly as it is', () => {
    const corrupt = memoryStorage({ [LEGACY_KEY]: '{nope' })
    expect(readLegacyPosts(corrupt, 'guest')).toEqual([])
    expect(corrupt.data[LEGACY_KEY]).toBe('{nope')
    expect(readLegacyPosts(memoryStorage({}), 'guest')).toEqual([])
    expect(readLegacyPosts(memoryStorage({ [LEGACY_KEY]: '{"posts":[{"id":"x"}]}' }), 'guest')).toEqual([])
    expect(readLegacyPosts(undefined, 'guest')).toEqual([])
  })

  it('reading never writes', () => {
    const s = memoryStorage({ [LEGACY_KEY]: guestBucket() })
    const before = s.data[LEGACY_KEY]
    readLegacyPosts(s, 'guest')
    expect(s.data[LEGACY_KEY]).toBe(before)
  })
})

describe('removing one, on request', () => {
  it('removes that post and its local comments, and keeps everything else in the bucket', () => {
    const s = memoryStorage({ [LEGACY_KEY]: guestBucket() })
    expect(removeLegacyPost(s, 'guest', 'mine-a')).toBe(true)
    const b = JSON.parse(s.data[LEGACY_KEY]!)
    expect(b.posts.map((p: { id: string }) => p.id)).toEqual(['mine-b'])
    expect(Object.keys(b.comments)).toEqual(['demo-1'])
    // Untouched: the guest name, old reactions (even on the removed post), comments elsewhere.
    expect(b.me).toEqual({ name: 'Gästen', handle: 'gasten', flair: 'Ny på stan' })
    expect(b.reactions).toEqual({ 'demo-1': ['hjarta'], 'mine-a': ['eld'] })
  })

  it('does nothing for an unknown post, another owner’s post, or unreadable data', () => {
    const s = memoryStorage({ [LEGACY_KEY]: guestBucket(), [`${LEGACY_KEY}:${ACCOUNT}`]: '{nope' })
    const before = { ...s.data }
    expect(removeLegacyPost(s, 'guest', 'mine-zzz')).toBe(false)
    expect(removeLegacyPost(s, ACCOUNT, 'mine-a')).toBe(false)
    expect(s.data).toEqual(before)
  })
})
