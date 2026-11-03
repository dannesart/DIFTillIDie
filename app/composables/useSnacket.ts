import type { NewsResponse, ReactionKey, Sport, Story } from '#shared/types/domain'
import type { LegacyLocalPost } from '~/lib/legacyLocal'
import { readLegacyPosts, removeLegacyPost } from '~/lib/legacyLocal'
import type { SnacketIdentity } from '~/lib/localScope'
import { resolveIdentity } from '~/lib/localScope'
import type { CommunityPost, PublishResult } from '~/lib/posts'

/*
 * Snacket på stan: real posts by signed-in supporters, from Supabase,
 * newest first. Filters (sport, #tag, Story) and Story counts come only
 * from those posts. Old browser-local posts are kept apart, read-only.
 */

export const REACTIONS: { key: ReactionKey, emoji: string, label: string }[] = [
  { key: 'hjarta', emoji: '💙', label: 'Blått hjärta' },
  { key: 'eld', emoji: '🔥', label: 'Eld' },
  { key: 'stjarna', emoji: '⭐', label: 'Guldstjärna' },
  { key: 'tarar', emoji: '😭', label: 'Tårar' },
]

export interface FeedFilter {
  tag?: string
  storyId?: string
}

export interface FeedPost {
  id: string
  author: { id: string, name: string, handle: string }
  body: string
  createdAt: string
  sport?: Sport
  storyId?: string
  /** Written by whoever is signed in here. */
  own: boolean
}

const toFeedPost = (p: CommunityPost, me: string | null): FeedPost => ({
  id: p.id,
  author: p.author,
  body: p.body,
  createdAt: p.createdAt,
  sport: p.sport,
  storyId: p.storyId,
  own: !!me && p.author.id === me,
})

export function useSnacket() {
  const loaded = useState('snacket-loaded', () => false)
  const filter = useState<FeedFilter>('snacket-filter', () => ({}))
  /** This owner's posts from before Snacket became real. Browser only, never published. */
  const legacy = useState<LegacyLocalPost[]>('snacket-legacy', () => [])
  const { sport, matches } = useSport()
  const auth = useAuth()
  const community = useCommunity()
  const owner = useLocalOwner()
  // Read the news already fetched for the page; never triggers a fetch itself.
  const { data: news } = useNuxtData<NewsResponse>('news')

  const identity = computed<SnacketIdentity>(() =>
    resolveIdentity(owner.value, auth.profile.value, auth.profileStatus.value))
  /** Who you post as right now, or null when you can't post. */
  const me = computed(() => identity.value.author ?? null)

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    // Each owner sees only their own old local posts, and only on this device.
    watch(owner, o => (legacy.value = o ? readLegacyPosts(localStorage, o) : []), { immediate: true })
    void community.refresh()
  }

  /** All real posts, newest first, exactly as Supabase returned them. */
  const all = computed<FeedPost[]>(() => community.posts.value.map(p => toFeedPost(p, auth.userId.value)))

  /** The feed: real posts through the sport, #tag and Story filters. Newest first, nothing ranked. */
  const feed = computed(() => {
    const { tag, storyId } = filter.value
    const story = storyId ? news.value?.stories.find(s => storyAnswersTo(s, storyId)) : undefined
    return all.value.filter(p =>
      matches(p.sport)
      && (!storyId || (story ? storyAnswersTo(story, p.storyId) : p.storyId === storyId))
      && (!tag || p.body.toLowerCase().includes(`#${tag.toLowerCase()}`)),
    )
  })

  /** Real posts about a Story, newest first. */
  const postsForStory = (story: Story) => all.value.filter(p => storyAnswersTo(story, p.storyId))
  const countForStory = (story: Story) => postsForStory(story).length

  /**
   * Publish to Supabase as the signed-in supporter. Only a confirmed insert
   * counts. By default the filters are cleared so the new post is in view;
   * `keepView` leaves them, for posting from a Story.
   */
  async function publish(body: string, opts: { sport?: Sport, storyId?: string, keepView?: boolean } = {}): Promise<PublishResult> {
    const { keepView, ...attach } = opts
    if (identity.value.kind !== 'member') return { ok: false, message: 'Logga in och välj ditt läktarnamn för att publicera.' }
    const r = await community.publish({ body, ...attach })
    if (r.ok && !keepView) filter.value = {}
    return r
  }

  /** Remove one old local post, because its writer asked to. Nothing else is touched. */
  function removeLegacy(id: string): boolean {
    const o = owner.value
    if (!o || !removeLegacyPost(localStorage, o, id)) return false
    legacy.value = readLegacyPosts(localStorage, o)
    return true
  }

  return { all, feed, community, filter, sport, me, identity, owner, legacy, load, publish, removeLegacy, countForStory, postsForStory }
}
