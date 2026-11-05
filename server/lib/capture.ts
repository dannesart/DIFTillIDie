import { createHmac } from 'node:crypto'
import type { FeedStatus, FrozenStory, Story, StoryCapture } from '../../shared/types/domain'
import { articleKey } from './news'

/*
 * Signed Story captures: what lets a post keep its Story after the articles
 * leave the RSS feeds, without trusting a browser with headlines.
 *
 * Whenever this server builds the Stories from the feeds, each Story gets a
 * capture: its sources as read from the publishers' feeds (headline, outlet,
 * publisher, URL, dates; never article text), as JSON, with an HMAC. The
 * browser sends that exact JSON and signature when it attaches the Story,
 * and the database's publish_post() verifies the signature with the same
 * key before freezing the JSON into the post, in the same transaction.
 *
 * The key is server-only (runtimeConfig.storyCapture, never `public`) and
 * kept in Supabase Vault on the database side. Without a key there are no
 * captures, and a Story can't be attached: never silently half-attached.
 */

export interface CaptureKey { kid: string, secret: string }

/** Sources a frozen reference may hold; Stories are a handful of articles. */
export const MAX_SOURCES = 20

export function freezeStory(story: Story, kid: string, feeds: Pick<FeedStatus, 'id' | 'fetchedAt'>[]): FrozenStory {
  const fetched = new Map(feeds.map(f => [f.id, f.fetchedAt]))
  const keyOf = new Map(story.sources.map(a => [a.id, articleKey(a.url)]))
  return {
    v: 1,
    kid,
    storyId: story.id,
    leadKey: keyOf.get(story.leadId) ?? keyOf.get(story.sources[0]!.id)!,
    sources: story.sources.slice(0, MAX_SOURCES).map(a => ({
      key: keyOf.get(a.id)!,
      id: a.id,
      ...(a.legacyId ? { legacyId: a.legacyId } : {}),
      sourceId: a.sourceId,
      outlet: a.outlet,
      publisher: a.publisher,
      headline: a.headline,
      url: a.url,
      publishedAt: a.publishedAt,
      capturedAt: fetched.get(a.sourceId) ?? null,
      reporting: a.reporting,
      sport: a.sport,
    })),
  }
}

export const signCapture = (data: string, secret: string) => createHmac('sha256', secret).update(data, 'utf8').digest('hex')

export function captureStory(story: Story, key: CaptureKey, feeds: Pick<FeedStatus, 'id' | 'fetchedAt'>[]): StoryCapture {
  const data = JSON.stringify(freezeStory(story, key.kid, feeds))
  return { data, sig: signCapture(data, key.secret) }
}

/** Every Story with its capture, or the Stories as they are when there's no key. */
export function withCaptures(stories: Story[], key: CaptureKey | null, feeds: Pick<FeedStatus, 'id' | 'fetchedAt'>[]): Story[] {
  if (!key) return stories
  return stories.map(s => ({ ...s, capture: captureStory(s, key, feeds) }))
}

/** The server's key from runtime config, if both halves are set. */
export function captureKeyFrom(config: { keyId?: string, key?: string } | undefined): CaptureKey | null {
  return config?.keyId && config.key ? { kid: config.keyId, secret: config.key } : null
}
