import type { Story } from '../types/domain'

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

/** Original reporting vs. compilations of others' reporting, for honest counts. */
export function reportingCounts(story: Story): { original: number, compiled: number, originalOutlets: string[] } {
  const original = story.sources.filter(s => s.reporting === 'original')
  return {
    original: original.length,
    compiled: story.sources.length - original.length,
    originalOutlets: [...new Set(original.map(s => s.outlet))],
  }
}
