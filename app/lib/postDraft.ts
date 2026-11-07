import type { Sport } from '#shared/types/domain'
import type { LocalOwner } from './localScope'
import { readScoped, scopedKey } from './localScope'

/*
 * The Snacket post being written in the compose dialog: its text, sport and
 * attached Story. Kept in this browser per owner (see localScope), like the
 * Story drafts, so closing the dialog or reloading never loses it, and
 * switching account never shows it to, or posts it as, someone else.
 */
export interface PostDraft {
  body: string
  sport?: Sport
  storyId?: string
}

export const POST_DRAFT_KEY = 'djurgarn:post-draft:v1'
const SPORTS: readonly string[] = ['fotboll', 'hockey'] satisfies Sport[]

export const emptyPostDraft = (): PostDraft => ({ body: '' })

/** Worth keeping: some text, or a chosen Story. A sport on its own is only a default. */
export const keepsPostDraft = (d: PostDraft) => !!d.body.trim() || !!d.storyId

/** One owner's draft; only what a draft can hold survives, anything else starts fresh. */
export function readPostDraft(storage: Pick<Storage, 'getItem'> | undefined, owner: LocalOwner): PostDraft {
  const raw = readScoped<Record<string, unknown>>(storage, scopedKey(POST_DRAFT_KEY, owner), () => ({}))
  return {
    body: typeof raw.body === 'string' ? raw.body : '',
    sport: SPORTS.includes(raw.sport as string) ? raw.sport as Sport : undefined,
    storyId: typeof raw.storyId === 'string' && raw.storyId ? raw.storyId : undefined,
  }
}

export function writePostDraft(storage: Pick<Storage, 'setItem' | 'removeItem'>, owner: LocalOwner, d: PostDraft) {
  const key = scopedKey(POST_DRAFT_KEY, owner)
  try {
    if (keepsPostDraft(d)) storage.setItem(key, JSON.stringify(d))
    else storage.removeItem(key)
  }
  catch { /* storage full or blocked */ }
}

/**
 * Opening the composer: a draft in progress stays exactly as it was; a fresh
 * one starts from what you're browsing (the sport filter, the Story whose
 * posts you're reading). A sport already chosen is kept.
 */
export function startPostDraft(d: PostDraft, browsing: { sport?: Sport, storyId?: string }): PostDraft {
  if (keepsPostDraft(d)) return d
  return { body: d.body, sport: d.sport ?? browsing.sport, storyId: browsing.storyId || undefined }
}

/**
 * Throwing a draft away on purpose: its text and attached Story go; the
 * sport stays as the next default, as after publishing. What's left isn't
 * worth keeping, so writing it removes the stored draft. The Story is
 * cleared explicitly, so it also goes when this is merged into a draft
 * (useCompose's setPost).
 */
export const discardPostDraft = (d: PostDraft): PostDraft => ({ body: '', sport: d.sport, storyId: undefined })

/**
 * What the compact entry shows of a draft worth keeping (keepsPostDraft):
 * its text, or, for a draft that's only an attached Story, that Story.
 * Null when there's no draft to show.
 */
export function postDraftPreview(d: PostDraft, storyHeadline?: string): string | null {
  if (!keepsPostDraft(d)) return null
  const text = d.body.trim()
  if (text) return text
  return storyHeadline ? `Om: ${storyHeadline}` : 'En Story bifogad'
}

/** Adds `@handle ` at the end, ready to write after; a handle already mentioned isn't added twice. */
export function withMention(body: string, handle: string) {
  const tag = `@${handle}`
  const at = new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i')
  if (at.test(body)) return /\s$/.test(body) ? body : `${body} `
  return `${body}${body && !/\s$/.test(body) ? ' ' : ''}${tag} `
}
