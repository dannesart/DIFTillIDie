import type { Sport, Story } from '#shared/types/domain'
import { findStory } from '#shared/utils/story'
import type { LocalOwner } from './localScope'
import { readScoped, scopedKey } from './localScope'

/*
 * The Snacket post being written in the compose dialog: its text, sport and
 * attached Story. Kept in this browser per owner (see localScope), like the
 * Story drafts, so closing the dialog or reloading never loses it, and
 * switching account never shows it to, or posts it as, someone else.
 */
export interface PostDraft extends DraftAttachment {
  body: string
  sport?: Sport
}

/**
 * The Story a draft is about, as the supporter chose it (Issue #25): the article whose headline they
 * saw (`leadId`), and that headline and outlet, to say which it was if it can't be found again.
 * `storyId` is the Story's id then; a draft from before 2026-11-14 has only that.
 */
export interface DraftAttachment {
  storyId?: string
  leadId?: string
  headline?: string
  outlet?: string
}

export const POST_DRAFT_KEY = 'djurgarn:post-draft:v1'
const SPORTS: readonly string[] = ['fotboll', 'hockey'] satisfies Sport[]

export const emptyPostDraft = (): PostDraft => ({ body: '' })

/** Worth keeping: some text, or a chosen Story. A sport on its own is only a default. */
export const keepsPostDraft = (d: PostDraft) => !!d.body.trim() || !!draftAttachment(d)

const text = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : undefined)

/** One owner's draft; only what a draft can hold survives, anything else starts fresh. */
export function readPostDraft(storage: Pick<Storage, 'getItem'> | undefined, owner: LocalOwner): PostDraft {
  return cleanPostDraft(readScoped<Record<string, unknown>>(storage, scopedKey(POST_DRAFT_KEY, owner), () => ({})))
}

/** What a stored draft can hold, from whatever was stored: text where text belongs, at sane lengths. */
export function cleanPostDraft(raw: Record<string, unknown>): PostDraft {
  return {
    body: typeof raw.body === 'string' ? raw.body : '',
    sport: SPORTS.includes(raw.sport as string) ? raw.sport as Sport : undefined,
    storyId: text(raw.storyId, 200),
    leadId: text(raw.leadId, 200),
    headline: text(raw.headline, 300),
    outlet: text(raw.outlet, 100),
  }
}

/** A draft's attachment, if it has one (an id is what makes one). */
export function draftAttachment(d: DraftAttachment): DraftAttachment | undefined {
  if (!d.storyId && !d.leadId) return undefined
  return { storyId: d.storyId, leadId: d.leadId, headline: d.headline, outlet: d.outlet }
}

/** The article whose headline a Story shows. */
export const leadArticle = (s: Story) => s.sources.find(a => a.id === s.leadId) ?? s.sources[0]!

/** Choosing a Story: its id, the article whose headline it shows now, and that headline and outlet. */
export function attachmentFrom(story: Story): DraftAttachment {
  const lead = leadArticle(story)
  return { storyId: story.id, leadId: lead.id, headline: lead.headline.slice(0, 300), outlet: lead.outlet.slice(0, 100) }
}

/** The change to a draft for attaching a Story, or (undefined) removing it: every attachment field together. */
export const attachmentPatch = (a: DraftAttachment | undefined): DraftAttachment =>
  ({ storyId: a?.storyId, leadId: a?.leadId, headline: a?.headline, outlet: a?.outlet })

/** Where the news stands: what an attachment that isn't found can and can't mean. */
export type NewsLoad = 'loading' | 'ready' | 'unavailable'
export const newsLoad = (status: string | undefined): NewsLoad =>
  status === 'success' ? 'ready' : status === 'error' ? 'unavailable' : 'loading'

/**
 * What a draft's attachment is now:
 *  - none: a normal post;
 *  - attached: the live Story holding the chosen article (`changed` when it shows another headline now);
 *  - confirm: a draft from before the chosen article was kept; its old id finds this Story, which the
 *    supporter must confirm, since that id names the Story's earliest article, maybe another event's;
 *  - missing / loading / unavailable: not found, and why it can't be found. Never "none".
 * A chosen article is never looked for by the old Story id.
 */
export type AttachmentState =
  | { kind: 'none' }
  | { kind: 'attached', story: Story, changed: boolean }
  | { kind: 'confirm', story: Story }
  | { kind: 'missing' | 'loading' | 'unavailable' }

export function resolveAttachment(a: DraftAttachment | undefined, stories: Story[], news: NewsLoad): AttachmentState {
  if (!a || (!a.storyId && !a.leadId)) return { kind: 'none' }
  if (a.leadId) {
    const story = stories.find(s => s.sources.some(x => x.id === a.leadId))
    if (story) return { kind: 'attached', story, changed: leadArticle(story).id !== a.leadId }
  }
  else {
    const story = findStory(stories, a.storyId)
    if (story) return { kind: 'confirm', story }
  }
  return { kind: news === 'ready' ? 'missing' : news }
}

/** Said when a post can't be published with what its draft says it's about; the text and the attachment stay. */
export const ATTACHMENT_REFUSED = {
  missing: 'Storyn du valde finns inte längre i nyhetsflödet. Välj Story igen eller ta bort kopplingen – ditt inlägg finns kvar.',
  loading: 'Nyheterna laddas fortfarande, så Storyn kan inte bekräftas än. Vänta en stund – ditt inlägg finns kvar.',
  unavailable: 'Nyheterna kunde inte hämtas just nu, så Storyn kan inte bekräftas. Försök igen om en stund eller ta bort kopplingen – ditt inlägg finns kvar.',
  confirm: 'Bekräfta vilken Story inlägget gäller innan du publicerar – ditt inlägg finns kvar.',
} as const

/** Why this can't be published as it stands, or null when it can (a normal post, or a Story that's there). */
export function attachmentRefusal(state: AttachmentState): string | null {
  return state.kind === 'none' || state.kind === 'attached' ? null : ATTACHMENT_REFUSED[state.kind]
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
export function startPostDraft(d: PostDraft, browsing: { sport?: Sport, story?: Story }): PostDraft {
  if (keepsPostDraft(d)) return d
  return { body: d.body, sport: d.sport ?? browsing.sport, ...attachmentPatch(browsing.story && attachmentFrom(browsing.story)) }
}

/**
 * Throwing a draft away on purpose: its text and attached Story go; the
 * sport stays as the next default, as after publishing. What's left isn't
 * worth keeping, so writing it removes the stored draft. The Story is
 * cleared explicitly, so it also goes when this is merged into a draft
 * (useCompose's setPost).
 */
export const discardPostDraft = (d: PostDraft): PostDraft => ({ body: '', sport: d.sport, ...attachmentPatch(undefined) })

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
