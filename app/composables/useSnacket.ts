import type { NewsResponse, Post, PostAuthor, PostComment, ReactionKey, Sport, Story } from '#shared/types/domain'
import { buildDemoPosts } from '~/data/posts'

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

/** What this visitor has done. Lives only in their browser. */
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
  const loaded = useState('snacket-loaded', () => false)
  const mode = useState<FeedMode>('snacket-mode', () => 'hetast')
  const filter = useState<FeedFilter>('snacket-filter', () => ({}))
  const { sport, matches } = useSport()
  // Read the news already fetched for the page; never triggers a fetch itself.
  const { data: news } = useNuxtData<NewsResponse>('news')

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) local.value = { ...freshLocal(), ...JSON.parse(raw) }
    }
    catch { /* private mode or corrupt data: start fresh */ }
    watch(local, (v) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) }
      catch { /* storage full or blocked */ }
    }, { deep: true })
  }

  const all = computed<FeedPost[]>(() => {
    const ownIds = new Set(local.value.posts.map(p => p.id))
    return [...local.value.posts, ...base.value].map((p) => {
      const mine = local.value.reactions[p.id] ?? []
      const reactions = { ...p.reactions }
      for (const k of mine) reactions[k]++
      return { ...p, reactions, comments: [...p.comments, ...(local.value.comments[p.id] ?? [])], mine, own: ownIds.has(p.id) }
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

  const countForStory = (story: Story) => all.value.filter(p => storyAnswersTo(story, p.storyId)).length

  function toggleReaction(postId: string, key: ReactionKey) {
    const mine = local.value.reactions[postId] ?? []
    local.value.reactions[postId] = mine.includes(key) ? mine.filter(k => k !== key) : [...mine, key]
  }

  function addComment(postId: string, body: string) {
    const text = body.trim()
    if (!text) return
    const list = local.value.comments[postId] ?? []
    local.value.comments[postId] = [...list, { id: uid(), author: { ...local.value.me }, body: text, createdAt: new Date().toISOString() }]
  }

  function publish(body: string, opts: { sport?: Sport, storyId?: string } = {}) {
    const text = body.trim()
    if (!text) return
    local.value.posts.unshift({
      id: `mine-${uid()}`,
      author: { ...local.value.me },
      body: text,
      createdAt: new Date().toISOString(),
      ...opts,
      reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0 },
      comments: [],
      demo: false,
    })
    mode.value = 'nyast'
    filter.value = {}
  }

  function remove(postId: string) {
    local.value.posts = local.value.posts.filter(p => p.id !== postId)
  }

  function setName(name: string) {
    const clean = name.trim().slice(0, 32)
    if (!clean) return
    local.value.me = {
      ...local.value.me,
      name: clean,
      handle: clean.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'blarandiggast',
    }
  }

  return { all, feed, mode, filter, sport, me: computed(() => local.value.me), load, toggleReaction, addComment, publish, remove, setName, countForStory }
}
