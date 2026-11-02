import type { Story } from '../types/domain'

/**
 * Does this Story answer to a reference made earlier (e.g. a post's
 * `storyId`)? A Story answers to `story-<id>` of ANY of its articles, so a
 * reference survives when Stories merge or a different article becomes the
 * earliest. It only breaks once the referenced article has left every feed.
 */
export function storyAnswersTo(story: Story, ref: string | undefined): boolean {
  if (!ref) return false
  return story.id === ref || story.sources.some(s => `story-${s.id}` === ref)
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
