import type { NewsResponse, ReactionKey, Sport, Story } from '#shared/types/domain'
import type { SnacketIdentity } from '~/lib/localScope'
import { resolveIdentity } from '~/lib/localScope'
import type { FeedSort } from '~/lib/feedSort'
import type { CommunityPost, PublishResult } from '~/lib/posts'

/*
 * Snacket på stan: real posts by signed-in supporters, from Supabase,
 * newest first (or Hetast, see lib/feedSort). Filters (sport, #tag, Story)
 * and Story counts come only from those posts. (Posts some browsers saved locally before Snacket
 * became real are left dormant in localStorage: never read, published or
 * deleted.)
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
  const sort = useState<FeedSort>('snacket-sort', () => 'nyast')
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
    void community.refresh()
  }

  /** All real posts, newest first, exactly as Supabase returned them. */
  const all = computed<FeedPost[]>(() => community.posts.value.map(p => toFeedPost(p, auth.userId.value)))

  /** Real posts through the sport, #tag and Story filters, newest first. (Hetast is applied on top, where the feed is shown.) */
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
   * counts. By default the filters are cleared and the feed goes back to
   * Nyast, so the new post is in view (at the top);
   * `keepView` leaves them, for posting from a Story.
   */
  async function publish(body: string, opts: { sport?: Sport, storyId?: string, keepView?: boolean } = {}): Promise<PublishResult> {
    const { keepView, ...attach } = opts
    if (identity.value.kind !== 'member') return { ok: false, message: 'Logga in och välj ditt läktarnamn för att publicera.' }
    const r = await community.publish({ body, ...attach })
    if (r.ok && !keepView) {
      filter.value = {}
      sort.value = 'nyast'
    }
    return r
  }

  return { all, feed, community, filter, sort, sport, me, identity, owner, load, publish, countForStory, postsForStory }
}
