import type { Story } from '#shared/types/domain'
import type { LocalOwner } from './localScope'
import { scopedKey } from './localScope'
import type { NewsLoad, PostDraft } from './postDraft'
import { attachmentFrom, attachmentPatch, cleanPostDraft, draftAttachment, resolveAttachment } from './postDraft'

/*
 * "Snacka om detta" drafts (Issue #25). Each is a draft of its own, with an id of its own, never a value
 * kept under a Story's id: Story ids change as the news moves (an earlier article leaves, Stories merge or
 * split), and a draft has to outlive that. It keeps what a Snacket draft keeps (postDraft): its text, and
 * the article the supporter chose with that headline and outlet. That article is what it's about now,
 * wherever it is (resolveAttachment); one that's gone leaves the draft to be recovered, never lost. Two
 * drafts that end up about one Story stay two.
 *
 * Kept in this browser per owner (localScope), like every draft, in the v2 store. Drafts written before
 * it (v1: one text per Story id, and no chosen article) are read from where they are, and never written
 * or deleted there. The v2 store says which of them it has taken over (`superseded`: their Story id and the
 * text it took over), in the same write that keeps the draft that takes over, or removes it once published
 * or thrown away. So:
 *  - nothing is lost: until that one write succeeds, the v1 draft is still shown, as it was;
 *  - nothing comes back, or shows twice: once it has, that v1 text is never shown again;
 *  - a v1 text written after that (an older tab) isn't the one taken over, and is shown.
 */

export const STORY_DRAFTS_V1_KEY = 'djurgarn:drafts:v1'
export const STORY_DRAFTS_KEY = 'djurgarn:story-drafts:v2'

export interface StoryDraft extends PostDraft {
  id: string
  /** When it was last kept; a v1 draft never was. */
  updatedAt?: string
  /** Read from the v1 store: its Story id and text there, which keeping or removing this draft takes over. */
  v1?: { key: string, text: string }
}

type Storage_ = Pick<Storage, 'getItem' | 'setItem'>

interface Store {
  drafts: StoryDraft[]
  /** Stored entries this version can't read: kept as they are, never thrown away by writing. */
  unknown: unknown[]
  superseded: Record<string, string>
  /** A v2 store that couldn't be read at all, as it was. Kept aside before anything replaces it. */
  unreadable?: string
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function storedDraft(raw: unknown): StoryDraft | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || r.id.length > 100 || typeof r.body !== 'string' || !r.body.trim()) return undefined
  const d: StoryDraft = { id: r.id, ...cleanPostDraft(r) }
  if (typeof r.updatedAt === 'string' && r.updatedAt.length <= 40) d.updatedAt = r.updatedAt
  return d
}

function readStore(storage: Pick<Storage, 'getItem'>, owner: LocalOwner): Store {
  const store: Store = { drafts: [], unknown: [], superseded: {} }
  const raw = storage.getItem(scopedKey(STORY_DRAFTS_KEY, owner))
  if (!raw) return store
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { parsed = undefined }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Store).drafts)) return { ...store, unreadable: raw }
  const p = parsed as { drafts: unknown[], superseded?: unknown }
  for (const entry of p.drafts) {
    const d = storedDraft(entry)
    if (d) store.drafts.push(d)
    else store.unknown.push(entry)
  }
  if (p.superseded && typeof p.superseded === 'object') {
    for (const [k, v] of Object.entries(p.superseded)) if (typeof v === 'string') store.superseded[k] = v
  }
  return store
}

/** The v1 drafts not yet taken over: one per Story id, its text. Read only. */
function readV1(storage: Pick<Storage, 'getItem'>, owner: LocalOwner, superseded: Record<string, string>): StoryDraft[] {
  let parsed: unknown
  try { parsed = JSON.parse(storage.getItem(scopedKey(STORY_DRAFTS_V1_KEY, owner)) ?? '{}') }
  catch { return [] }
  if (!parsed || typeof parsed !== 'object') return []
  return Object.entries(parsed as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim() && superseded[e[0]] !== e[1])
    .map(([key, text]) => ({ id: `v1:${key}`, body: text, storyId: key, v1: { key, text } }))
}

/** All of one owner's Story drafts, the most recently kept first, v1 drafts last. Unreadable storage: none. */
export function readStoryDrafts(storage: Pick<Storage, 'getItem'> | undefined, owner: LocalOwner): StoryDraft[] {
  if (!storage) return []
  try {
    const store = readStore(storage, owner)
    const kept = [...store.drafts].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    return [...kept, ...readV1(storage, owner, store.superseded)]
  }
  catch { return [] }
}

function writeStore(storage: Storage_, owner: LocalOwner, store: Store): boolean {
  const key = scopedKey(STORY_DRAFTS_KEY, owner)
  try {
    if (store.unreadable !== undefined) {
      // What was there is kept aside first, once; never replaced if that can't be done.
      const aside = `${key}:unreadable`
      const there = storage.getItem(aside)
      if (there !== null && there !== store.unreadable) return false
      if (there === null) storage.setItem(aside, store.unreadable)
    }
    storage.setItem(key, JSON.stringify({ drafts: [...store.drafts, ...store.unknown], superseded: store.superseded }))
    return true
  }
  catch { return false }
}

/** Changing a store: read as it is now (another tab may have written), one change, one write. */
function change(storage: Storage_, owner: LocalOwner, d: StoryDraft, keep?: StoryDraft): boolean {
  let store: Store
  try { store = readStore(storage, owner) }
  catch { return false }
  const drafts = store.drafts.filter(x => x.id !== d.id)
  if (keep) drafts.unshift(keep)
  const superseded = d.v1 ? { ...store.superseded, [d.v1.key]: d.v1.text } : store.superseded
  return writeStore(storage, owner, { ...store, drafts, superseded })
}

/**
 * Keep a draft as it is now; only this draft changes. A v1 draft becomes one of its own here (a new id),
 * and is taken over in the same write. Without text it isn't worth keeping, so it's removed.
 * Returns the draft as kept (what to carry on with), or null when it couldn't be: then nothing changed.
 */
export function saveStoryDraft(storage: Storage_, owner: LocalOwner, d: StoryDraft, now = new Date().toISOString()): StoryDraft | null {
  const { v1: _, ...rest } = d
  const kept: StoryDraft = { ...rest, id: d.v1 ? newId() : d.id, ...attachmentPatch(draftAttachment(d)), updatedAt: now }
  return change(storage, owner, d, d.body.trim() ? kept : undefined) ? kept : null
}

/** Remove one draft (published, or thrown away on purpose), and only that one. False: nothing changed. */
export const removeStoryDraft = (storage: Storage_, owner: LocalOwner, d: StoryDraft): boolean => change(storage, owner, d)

/** A new draft about a Story: the article whose headline it shows, as chosen now; not kept until it has text. */
export const newStoryDraft = (story: Story): StoryDraft => ({ id: newId(), body: '', sport: story.sport, ...attachmentFrom(story) })

/** The drafts about this Story now: by the article each chose (an old draft: by its old id, to confirm). */
export function draftsAbout(drafts: StoryDraft[], story: Story, stories: Story[]): StoryDraft[] {
  return drafts.filter((d) => {
    const s = resolveAttachment(draftAttachment(d), stories, 'ready')
    return (s.kind === 'attached' || s.kind === 'confirm') && s.story.id === story.id
  })
}

/**
 * The drafts no Story leads to, so the supporter can find them: their Story is gone, can't be confirmed,
 * or was removed. While the news is loading, none yet: it can't be told.
 */
export function draftsToRecover(drafts: StoryDraft[], stories: Story[], news: NewsLoad): StoryDraft[] {
  if (news === 'loading') return []
  return drafts.filter(d => resolveAttachment(draftAttachment(d), stories, news).kind !== 'attached')
}
