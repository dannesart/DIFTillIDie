import type { NewsResponse, Post, PostAuthor, PostComment, ReactionKey, Sport, Story } from '#shared/types/domain'
import { buildDemoPosts } from '~/data/posts'
import type { LocalOwner, SnacketIdentity } from '~/lib/localScope'
import { readScoped, resolveIdentity, scopedKey } from '~/lib/localScope'

export const REACTIONS: { key: ReactionKey, emoji: string, label: string }[] = [
  { key: 'hjarta', emoji: '💙', label: 'Blått hjärta' },
  { key: 'eld', emoji: '🔥', label: 'Eld' },
  { key: 'stjarna', emoji: '⭐', label: 'Guldstjärna' },
  { key: 'tarar', emoji: '😭', label: 'Tårar' },
]

export type FeedMode = 'hetast' | 'nyast'

export interface FeedFilter {
  tag?: string
  storyId?: string
}

/**
 * What this visitor has done. Lives only in their browser, in one bucket per
 * owner: the guest, or each signed-in account. `me` is the guest's local name
 * and is only kept in the guest bucket.
 */
interface LocalState {
  me: PostAuthor
  posts: Post[]
  reactions: Record<string, ReactionKey[]>
  comments: Record<string, PostComment[]>
}

export interface FeedPost extends Post {
  mine: ReactionKey[]
  own: boolean
}

const STORAGE_KEY = 'djurgarn:snacket:v1'

const freshLocal = (): LocalState => ({
  me: { name: 'Du', handle: 'blarandiggast', flair: 'Ny på stan' },
  posts: [],
  reactions: {},
  comments: {},
})

/** Hot = engagement, gently cooled by age. */
function heat(post: Post, now: number) {
  const engagement = Object.values(post.reactions).reduce((a, b) => a + b, 0) + post.comments.length * 3
  const hours = (now - new Date(post.createdAt).getTime()) / 3_600_000
  return (engagement + 1) / Math.pow(hours + 2, 1.4)
}

const uid = () => Math.random().toString(36).slice(2, 10)

export function useSnacket() {
  const demoNow = useDemoNow()
  const base = useState('snacket-base', () => buildDemoPosts(demoNow.value))
  const local = useState<LocalState>('snacket-local', freshLocal)
  /** Whose bucket `local` holds. Null until loaded in the browser and auth is known. */
  const owner = useState<LocalOwner | null>('snacket-owner', () => null)
  /** Posts the guest left in this browser, mentioned while someone is signed in. */
  const guestPostCount = useState('snacket-guest-posts', () => 0)
  const loaded = useState('snacket-loaded', () => false)
  const mode = useState<FeedMode>('snacket-mode', () => 'hetast')
  const filter = useState<FeedFilter>('snacket-filter', () => ({}))
  const { sport, matches } = useSport()
  const auth = useAuth()
  const authOwner = useLocalOwner()
  // Read the news already fetched for the page; never triggers a fetch itself.
  const { data: news } = useNuxtData<NewsResponse>('news')

  const identity = computed<SnacketIdentity>(() =>
    resolveIdentity(owner.value, local.value.me, auth.profile.value, auth.profileStatus.value))
  /** Who you post as right now, or null when you can't post yet. */
  const me = computed(() => identity.value.author ?? null)

  function switchTo(next: LocalOwner | null) {
    owner.value = next
    local.value = next ? readScoped(localStorage, scopedKey(STORAGE_KEY, next), freshLocal) : freshLocal()
    guestPostCount.value = next && next !== 'guest' ? readScoped(localStorage, STORAGE_KEY, freshLocal).posts.length : 0
  }

  /** Saved straight into the bucket it was made in, never into whoever signs in next. */
  function save() {
    const o = owner.value
    if (!o) return
    const { me: guestName, ...content } = local.value
    try { localStorage.setItem(scopedKey(STORAGE_KEY, o), JSON.stringify(o === 'guest' ? { me: guestName, ...content } : content)) }
    catch { /* storage full or blocked */ }
  }

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    watch(authOwner, switchTo, { immediate: true })
  }

  const all = computed<FeedPost[]>(() => {
    const ownIds = new Set(local.value.posts.map(p => p.id))
    // A signed-in supporter's own posts and comments always show their current profile.
    const live = identity.value.kind === 'member' ? identity.value.author : null
    const byMe = <T extends { author: PostAuthor }>(x: T): T => (live ? { ...x, author: { ...live } } : x)
    return [...local.value.posts.map(byMe), ...base.value].map((p) => {
      const mine = local.value.reactions[p.id] ?? []
      const reactions = { ...p.reactions }
      for (const k of mine) reactions[k]++
      return { ...p, reactions, comments: [...p.comments, ...(local.value.comments[p.id] ?? []).map(byMe)], mine, own: ownIds.has(p.id) }
    })
  })

  const feed = computed(() => {
    const now = loaded.value ? Date.now() : demoNow.value
    const { tag, storyId } = filter.value
    const story = storyId ? news.value?.stories.find(s => storyAnswersTo(s, storyId)) : undefined
    const list = all.value.filter(p =>
      matches(p.sport)
      && (!storyId || (story ? storyAnswersTo(story, p.storyId) : p.storyId === storyId))
      && (!tag || p.body.toLowerCase().includes(`#${tag.toLowerCase()}`)),
    )
    return mode.value === 'nyast'
      ? list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : list.sort((a, b) => heat(b, now) - heat(a, now))
  })

  /** Posts about a Story, newest first. */
  const postsForStory = (story: Story) => all.value
    .filter(p => storyAnswersTo(story, p.storyId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const countForStory = (story: Story) => postsForStory(story).length

  function toggleReaction(postId: string, key: ReactionKey) {
    if (!owner.value) return
    const mine = local.value.reactions[postId] ?? []
    local.value.reactions[postId] = mine.includes(key) ? mine.filter(k => k !== key) : [...mine, key]
    save()
  }

  function addComment(postId: string, body: string) {
    const text = body.trim()
    if (!text || !me.value) return
    const list = local.value.comments[postId] ?? []
    local.value.comments[postId] = [...list, { id: uid(), author: { ...me.value }, body: text, createdAt: new Date().toISOString() }]
    save()
  }

  /**
   * Publish a post (only to this browser). By default the feed jumps to
   * "Nyast" so you see it; `keepView` leaves the feed as it is, for
   * posting from somewhere else on the page, like a Story.
   */
  function publish(body: string, opts: { sport?: Sport, storyId?: string, keepView?: boolean } = {}): string | undefined {
    const text = body.trim()
    if (!text || !me.value) return
    const { keepView, ...attach } = opts
    const id = `mine-${uid()}`
    local.value.posts.unshift({
      id,
      author: { ...me.value },
      body: text,
      createdAt: new Date().toISOString(),
      ...attach,
      reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 },
      comments: [],
      demo: false,
    })
    save()
    if (!keepView) {
      mode.value = 'nyast'
      filter.value = {}
    }
    return id
  }

  function remove(postId: string) {
    local.value.posts = local.value.posts.filter(p => p.id !== postId)
    save()
  }

  /** The guest's local name. Signed-in supporters change their profile instead. */
  function setName(name: string) {
    const clean = name.trim().slice(0, 32)
    if (!clean || owner.value !== 'guest') return
    local.value.me = {
      ...local.value.me,
      name: clean,
      handle: clean.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'blarandiggast',
    }
    save()
  }

  return { all, feed, mode, filter, sport, me, identity, owner, guestPostCount, load, toggleReaction, addComment, publish, remove, setName, countForStory, postsForStory }
}
