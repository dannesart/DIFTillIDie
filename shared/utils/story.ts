import type { FrozenStory, Story } from '../types/domain'

/**
 * Does this Story answer to a reference made earlier (e.g. a post's
 * `storyId`)? A Story answers to `story-<id>` of ANY of its articles, so a
 * reference survives when Stories merge or a different article becomes the
 * earliest. It only breaks once the referenced article has left every feed.
 * Older posts use the articles' legacy ids, which Stories answer to as well.
 */
export function storyAnswersTo(story: Story, ref: string | undefined): boolean {
  if (!ref) return false
  return story.id === ref || story.sources.some(s => `story-${s.id}` === ref || (!!s.legacyId && `story-${s.legacyId}` === ref))
}

/**
 * The one Story a reference points at, or nothing. A legacy id is a 32-bit
 * hash, so two live Stories can answer to it: then it's ambiguous, and we
 * show nothing rather than guess.
 */
export function findStory(stories: Story[], ref: string | undefined): Story | undefined {
  if (!ref) return undefined
  const exact = stories.find(s => s.id === ref || s.sources.some(a => `story-${a.id}` === ref))
  if (exact) return exact
  const legacy = stories.filter(s => storyAnswersTo(s, ref))
  return legacy.length === 1 ? legacy[0] : undefined
}

/** What a published post keeps about its Story. */
export interface PostStoryEvidence {
  storyId?: string
  /** The Story frozen and signed when it was published. Absent for posts from before 2026-11-05. */
  storyRef?: FrozenStory
  /** The post has a frozen Story, but it couldn't be read: it is not a legacy post. */
  storyRefInvalid?: boolean
}

/**
 * The live Story a published post is about, or nothing (Issue #25). The links, counts and filters of
 * Stories all use this, so they always agree.
 *  - A post with a frozen Story follows the article whose headline it showed (its lead), into whichever
 *    live Story holds that article now. Not its `storyId`: that names the Story's earliest article, which a
 *    regrouping can put in another event's Story. No lead in the feeds, or no readable lead: nothing.
 *  - A post from before frozen Stories has only its `storyId`, resolved as always (findStory).
 */
export function storyOfPost(stories: Story[], post: PostStoryEvidence): Story | undefined {
  if (post.storyRefInvalid) return undefined
  if (!post.storyRef) return findStory(stories, post.storyId)
  const sources = Array.isArray(post.storyRef.sources) ? post.storyRef.sources : []
  const lead = sources.find(s => !!s && typeof s.key === 'string' && s.key === post.storyRef!.leadKey)
  const id = lead && typeof lead.id === 'string' ? lead.id : ''
  if (!id) return undefined
  return stories.find(s => s.sources.some(a => a.id === id))
}

/** The posts about a live Story: those storyOfPost resolves to it. */
export function postsAboutStory<P extends PostStoryEvidence>(stories: Story[], posts: P[], story: Story): P[] {
  return posts.filter(p => storyOfPost(stories, p) === story)
}

/**
 * The posts shown for a Story filter (a live Story's id). When that Story has left the feeds, only posts
 * from before frozen Stories that kept exactly this id; a post with a frozen Story is never matched by id.
 */
export function postsForStoryFilter<P extends PostStoryEvidence>(stories: Story[], posts: P[], storyId: string): P[] {
  const story = findStory(stories, storyId)
  if (story) return postsAboutStory(stories, posts, story)
  return posts.filter(p => !p.storyRef && !p.storyRefInvalid && p.storyId === storyId)
}

/** Original reporting vs. compilations of others' reporting, for honest counts. */
export function reportingCounts(story: Story): { original: number, compiled: number, originalOutlets: string[] } {
  const original = story.sources.filter(s => s.reporting === 'original')
  return {
    original: original.length,
    compiled: story.sources.length - original.length,
    originalOutlets: [...new Set(original.map(s => s.outlet))],
  }
}
