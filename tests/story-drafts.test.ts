import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStore } from '../app/lib/auth'
import type { LocalOwner } from '../app/lib/localScope'
import type { NewsLoad } from '../app/lib/postDraft'
import { ATTACHMENT_REFUSED, attachmentFrom, attachmentPatch, draftAttachment, POST_DRAFT_KEY, readPostDraft, resolveAttachment, writePostDraft } from '../app/lib/postDraft'
import { createCommunity } from '../app/lib/posts'
import type { StoryDraft } from '../app/lib/storyDrafts'
import { draftsAbout, draftsToRecover, newStoryDraft, readStoryDrafts, removeStoryDraft, saveStoryDraft, STORY_DRAFTS_KEY, STORY_DRAFTS_V1_KEY } from '../app/lib/storyDrafts'
import type { SourceArticle, Story } from '../shared/types/domain'
import { article } from './helpers'

/*
 * "Snacka om detta" drafts (Issue #25): drafts of their own, found again by the article each chose, that
 * outlive Story ids changing, Stories merging and splitting, and articles leaving the feeds. Old (v1)
 * drafts, kept per Story id, are taken over without being lost, shown twice or coming back.
 *
 * The Stories are built by hand, as the server would send them, never by the grouping algorithm, so the
 * regroupings tested are exactly the ones named.
 */

const HASSE_ID = '22222222-2222-4222-8222-222222222222'
const HASSE: LocalOwner = `account:${HASSE_ID}`
const LOTTA: LocalOwner = 'account:33333333-3333-4333-8333-333333333333'

function memoryStorage(data: Record<string, string> = {}) {
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v },
    removeItem: (k: string) => { delete data[k] },
  }
}

/** Supabase, as far as publishing goes: every publish_post call recorded; `fail` answers with an error. */
function fakeClient(fail = false) {
  const sent: Record<string, unknown>[] = []
  const client = {
    rpc(_fn: string, args: Record<string, unknown>) {
      sent.push(args)
      return { select: () => ({ single: async () => (fail
        ? { data: null, error: { message: 'network down', code: 'XX000' } }
        : { data: { id: `p-${sent.length}`, body: args.p_body, sport: null, story_id: null, created_at: '2026-11-14T10:00:00Z', author: { id: HASSE_ID, display_name: 'Hovet-Hasse', handle: 'hovethasse' } }, error: null }) }) }
    },
  }
  return { client: client as unknown as SupabaseClient, sent }
}
const auth = { status: ref('signed-in'), profileStatus: ref('ready'), profile: ref({ id: HASSE_ID, displayName: 'Hovet-Hasse', handle: 'hovethasse' }), userId: ref(HASSE_ID) } as unknown as AuthStore

/**
 * Publishing a Story draft as the dialog does: the draft's attachment checked against the Stories as they
 * are; once published, that draft (only) is removed; refused or failed, it's left as it is.
 */
async function publishDraft(storage: ReturnType<typeof memoryStorage>, owner: LocalOwner, d: StoryDraft, stories: Story[], opts: { news?: NewsLoad, fail?: boolean } = {}) {
  const { client, sent } = fakeClient(opts.fail)
  const r = await createCommunity(client, auth).publish({ body: d.body, sport: d.sport, attach: { attachment: draftAttachment(d), stories, news: opts.news ?? 'ready' } })
  if (r.ok) removeStoryDraft(storage, owner, d)
  return { r, sent }
}

const at = (h: number) => new Date(Date.UTC(2026, 10, 9, 22) + h * 3_600_000).toISOString()
// A: an earlier, compiled article; I: the original report the supporter sees as the headline.
const A = article({ headline: 'Expert: tränaren lämnar efter säsongen', publishedAt: at(0), reporting: 'compiled', outlet: 'Bollsvenskan' })
const B = article({ headline: 'Officiellt: tränaren sparkas', publishedAt: at(12), reporting: 'compiled', outlet: 'Bollsvenskan' })
const I = article({ headline: 'Sportchefen förklarar varför tränaren sparkades', publishedAt: at(37), reporting: 'original', outlet: 'Sportbladet' })
const M = article({ headline: 'Inför bortamatchen mot Sirius', publishedAt: at(47), reporting: 'compiled', outlet: 'Bollsvenskan' })
const X = article({ headline: 'Klubben bekräftar: ny sportchef på plats', publishedAt: at(30), reporting: 'original', outlet: 'Expressen' })
const O = article({ headline: 'Tränarfrågan: styrelsen samlas', publishedAt: at(-10), reporting: 'compiled', outlet: 'Fotbollskanalen' })

/** A Story as the server sends it: id from the earliest article, original reporting leads, with a capture. */
function story(sources: SourceArticle[]): Story {
  const s = [...sources].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt))
  const id = `story-${s[0]!.id}`
  return { id, sport: 'fotboll', sources: s, leadId: (s.find(a => a.reporting === 'original') ?? s[0]!).id, sharedNames: [], updatedAt: s.at(-1)!.publishedAt, capture: { data: `{"storyId":"${id}"}`, sig: `sig-${id}` } }
}

/** Writing in a draft, as the dialog does: kept as typed, carried on with as kept. */
function write(storage: ReturnType<typeof memoryStorage>, owner: LocalOwner, d: StoryDraft, body: string) {
  const kept = saveStoryDraft(storage, owner, { ...d, body })
  expect(kept).not.toBeNull()
  return kept!
}

const v1Store = (owner: LocalOwner, drafts: Record<string, string>) => ({ [owner === 'guest' ? STORY_DRAFTS_V1_KEY : `${STORY_DRAFTS_V1_KEY}:${owner}`]: JSON.stringify(drafts) })
const v2Key = (owner: LocalOwner) => (owner === 'guest' ? STORY_DRAFTS_KEY : `${STORY_DRAFTS_KEY}:${owner}`)

const whole = story([A, B, I, M])

describe('a new Story draft', () => {
  it('keeps the article whose headline the supporter saw, never the Story\'s earliest article', () => {
    const d = newStoryDraft(whole)
    expect(whole.id).toBe(`story-${A.id}`)
    expect(d).toMatchObject({ body: '', sport: 'fotboll', storyId: whole.id, leadId: I.id, headline: I.headline, outlet: 'Sportbladet' })
    expect(d.leadId).not.toBe(A.id)
  })

  it('is its own draft: an id of its own, and only kept once it has text', () => {
    const s = memoryStorage()
    const d = newStoryDraft(whole)
    expect(newStoryDraft(whole).id).not.toBe(d.id)
    expect(readStoryDrafts(s, HASSE)).toEqual([])
    const kept = write(s, HASSE, d, 'Rätt beslut.')
    expect(kept.id).toBe(d.id)
    expect(readStoryDrafts(s, HASSE)).toEqual([kept])
    expect(kept.updatedAt).toBeTruthy()
  })
})

describe('the Story regroups: the draft follows the article it chose', () => {
  it('the Story id changes when its earlier article leaves the feeds', async () => {
    const s = memoryStorage()
    const d = write(s, HASSE, newStoryDraft(whole), 'Rätt beslut, fel timing.')
    const now = story([B, I, M])
    expect(now.id).not.toBe(whole.id)
    expect(draftsAbout(readStoryDrafts(s, HASSE), now, [now])).toEqual([d])
    expect(draftsToRecover(readStoryDrafts(s, HASSE), [now], 'ready')).toEqual([])
    const { r, sent } = await publishDraft(s, HASSE, d, [now])
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_story: now.capture!.data, p_story_sig: now.capture!.sig })
  })

  it('merged into an older Story: found there, under the older Story\'s id', () => {
    const s = memoryStorage()
    const own = story([I])
    const d = write(s, HASSE, newStoryDraft(own), 'Äntligen.')
    const merged = story([O, I])
    expect(merged.id).toBe(`story-${O.id}`)
    expect(draftsAbout(readStoryDrafts(s, HASSE), merged, [merged])).toEqual([d])
    expect(resolveAttachment(draftAttachment(d), [merged], 'ready')).toEqual({ kind: 'attached', story: merged, changed: false })
  })

  it('split in parts: only the part holding the chosen article, not the part keeping the old id', () => {
    const s = memoryStorage()
    const d = write(s, HASSE, newStoryDraft(whole), 'Rätt beslut.')
    const parts = [story([A]), story([B, I]), story([M])]
    expect(parts[0]!.id).toBe(d.storyId)
    const drafts = readStoryDrafts(s, HASSE)
    expect(parts.map(p => draftsAbout(drafts, p, parts).length)).toEqual([0, 1, 0])
  })

  it('the chosen article leaves the feeds: recoverable, with its text, headline and outlet, never published without its Story', async () => {
    const s = memoryStorage()
    const d = write(s, HASSE, newStoryDraft(whole), 'Rätt beslut.')
    const now = [story([A, B, M])]
    expect(now[0]!.id).toBe(whole.id) // the old id is still there; it isn't what the draft is about
    expect(draftsAbout(readStoryDrafts(s, HASSE), now[0]!, now)).toEqual([])
    expect(draftsToRecover(readStoryDrafts(s, HASSE), now, 'ready')).toEqual([d])
    const { r, sent } = await publishDraft(s, HASSE, d, now)
    expect([r, sent]).toEqual([{ ok: false, message: ATTACHMENT_REFUSED.missing }, []])
    expect(readStoryDrafts(s, HASSE)).toEqual([d])
    expect(d).toMatchObject({ body: 'Rätt beslut.', headline: I.headline, outlet: 'Sportbladet' })
  })

  it('the Story shows another headline now: said to have changed, and the headline chosen is never replaced', () => {
    const s = memoryStorage()
    const d = write(s, HASSE, newStoryDraft(whole), 'Rätt beslut.')
    const merged = story([A, B, I, M, X])
    expect(merged.leadId).toBe(X.id)
    expect(resolveAttachment(draftAttachment(d), [merged], 'ready')).toEqual({ kind: 'attached', story: merged, changed: true })
    const later = write(s, HASSE, d, 'Rätt beslut, fel timing.')
    expect(later).toMatchObject({ leadId: I.id, headline: I.headline, outlet: 'Sportbladet' })
    expect(readStoryDrafts(s, HASSE)[0]).toMatchObject({ leadId: I.id, headline: I.headline })
  })

  it('a new Story from a regrouping is never written into a draft about another', () => {
    const s = memoryStorage()
    const d = write(s, HASSE, newStoryDraft(story([I])), 'Om sportchefen.')
    expect(draftsAbout(readStoryDrafts(s, HASSE), story([X]), [story([X]), story([I])])).toEqual([])
    expect(readStoryDrafts(s, HASSE)).toEqual([d])
  })
})

describe('two drafts that now belong to one Story', () => {
  const first = story([I])
  const second = story([X])
  const merged = story([I, X])

  function two() {
    const s = memoryStorage()
    const a = write(s, HASSE, newStoryDraft(first), 'Om förklaringen.')
    const b = write(s, HASSE, newStoryDraft(second), 'Om nye sportchefen.')
    return { s, a, b }
  }

  it('are both about it, and stay two: never merged, either kept as it was', () => {
    const { s, a, b } = two()
    const about = draftsAbout(readStoryDrafts(s, HASSE), merged, [merged])
    expect(about.map(d => d.body).sort()).toEqual(['Om förklaringen.', 'Om nye sportchefen.'])
    expect(about.map(d => d.leadId).sort()).toEqual([I.id, X.id].sort())
    expect(new Set(about.map(d => d.id)).size).toBe(2)
    expect([a.id, b.id]).toEqual(expect.arrayContaining(about.map(d => d.id)))
  })

  it('writing in one never changes the other', () => {
    const { s, a, b } = two()
    write(s, HASSE, a, 'Om förklaringen, igen.')
    expect(readStoryDrafts(s, HASSE).find(d => d.id === b.id)).toEqual(b)
  })

  it('publishing one removes exactly that one', async () => {
    const { s, a, b } = two()
    const { r } = await publishDraft(s, HASSE, a, [merged])
    expect(r.ok).toBe(true)
    expect(readStoryDrafts(s, HASSE)).toEqual([b])
  })

  it('throwing one away removes exactly that one', () => {
    const { s, a, b } = two()
    expect(removeStoryDraft(s, HASSE, b)).toBe(true)
    expect(readStoryDrafts(s, HASSE)).toEqual([a])
  })

  it('a failed publish leaves both exactly as they were', async () => {
    const { s, a } = two()
    const before = { ...s.data }
    const { r, sent } = await publishDraft(s, HASSE, a, [merged], { fail: true })
    expect(r.ok).toBe(false)
    expect(sent).toHaveLength(1)
    expect(s.data).toEqual(before)
  })
})

describe('drafts from before (v1: text per Story id)', () => {
  const v1Text = 'Gammalt utkast om tränaren'

  it('are shown, as they were, needing confirmation even when the old id still finds the Story', async () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: v1Text }))
    const [d] = readStoryDrafts(s, HASSE)
    expect(d).toMatchObject({ body: v1Text, storyId: whole.id, v1: { key: whole.id, text: v1Text } })
    expect(d!.leadId).toBeUndefined()
    expect(resolveAttachment(draftAttachment(d!), [whole], 'ready')).toEqual({ kind: 'confirm', story: whole })
    // Shown on the Story it says (to confirm), and in the list to see over.
    expect(draftsAbout([d!], whole, [whole])).toEqual([d])
    expect(draftsToRecover([d!], [whole], 'ready')).toEqual([d])
    const { r, sent } = await publishDraft(s, HASSE, d!, [whole])
    expect([r, sent]).toEqual([{ ok: false, message: ATTACHMENT_REFUSED.confirm }, []])
  })

  it('confirmed: a draft of its own from then on, publishing with that Story, and nothing comes back', async () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: v1Text }))
    const v1Before = s.data[`${STORY_DRAFTS_V1_KEY}:${HASSE}`]
    const [old] = readStoryDrafts(s, HASSE)
    const confirmed = saveStoryDraft(s, HASSE, { ...old!, ...attachmentPatch(attachmentFrom(whole)) })!
    expect(confirmed.id).not.toBe(old!.id)
    expect(confirmed.v1).toBeUndefined()
    expect(confirmed).toMatchObject({ body: v1Text, leadId: I.id })
    // Shown once: as the new draft, not the old one too.
    expect(readStoryDrafts(s, HASSE)).toEqual([confirmed])
    const { r, sent } = await publishDraft(s, HASSE, confirmed, [whole])
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_body: v1Text, p_story: whole.capture!.data })
    // Published: gone, and the v1 record (never written or deleted) doesn't bring it back.
    expect(readStoryDrafts(s, HASSE)).toEqual([])
    expect(s.data[`${STORY_DRAFTS_V1_KEY}:${HASSE}`]).toBe(v1Before)
  })

  it('whose Story is gone: recoverable, its text kept', () => {
    const s = memoryStorage(v1Store(HASSE, { 'story-gone-123': v1Text }))
    const drafts = readStoryDrafts(s, HASSE)
    expect(drafts).toHaveLength(1)
    expect(draftsToRecover(drafts, [whole], 'ready')).toEqual(drafts)
  })

  it('a new Story chosen for it: about that Story, the old one taken over in the same write', () => {
    const s = memoryStorage(v1Store(HASSE, { 'story-gone-123': v1Text }))
    const [old] = readStoryDrafts(s, HASSE)
    const other = story([X])
    const moved = saveStoryDraft(s, HASSE, { ...old!, ...attachmentPatch(attachmentFrom(other)) })!
    expect(readStoryDrafts(s, HASSE)).toEqual([moved])
    expect(draftsAbout([moved], other, [other])).toEqual([moved])
  })

  it('its Story removed on purpose: kept, as an ordinary post to be, and still findable', async () => {
    const s = memoryStorage(v1Store(HASSE, { 'story-gone-123': v1Text }))
    const [old] = readStoryDrafts(s, HASSE)
    const plain = saveStoryDraft(s, HASSE, { ...old!, ...attachmentPatch(undefined) })!
    expect(readStoryDrafts(s, HASSE)).toEqual([plain])
    expect(draftsToRecover([plain], [whole], 'ready')).toEqual([plain])
    const { r, sent } = await publishDraft(s, HASSE, plain, [whole])
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_story: null })
  })

  it('thrown away: gone for good, the v1 record left as it was', () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: v1Text, 'story-other': 'Ett annat' }))
    const drafts = readStoryDrafts(s, HASSE)
    const old = drafts.find(d => d.body === v1Text)!
    expect(removeStoryDraft(s, HASSE, old)).toBe(true)
    expect(readStoryDrafts(s, HASSE).map(d => d.body)).toEqual(['Ett annat'])
    expect(JSON.parse(s.data[`${STORY_DRAFTS_V1_KEY}:${HASSE}`]!)).toEqual({ [whole.id]: v1Text, 'story-other': 'Ett annat' })
  })

  it('written in: taken over once, never shown twice, whatever is typed next', () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: v1Text }))
    const [old] = readStoryDrafts(s, HASSE)
    let d = write(s, HASSE, old!, `${v1Text}!`)
    d = write(s, HASSE, d, `${v1Text}!!`)
    expect(readStoryDrafts(s, HASSE)).toEqual([d])
    expect(d.storyId).toBe(whole.id) // still only the old id: confirmation still needed
    expect(resolveAttachment(draftAttachment(d), [whole], 'ready').kind).toBe('confirm')
  })

  it('emptied while writing: taken over (it was thrown away), and what is typed after is a draft of its own', () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: v1Text }))
    const [old] = readStoryDrafts(s, HASSE)
    const empty = write(s, HASSE, old!, '')
    expect(readStoryDrafts(s, HASSE)).toEqual([])
    const again = write(s, HASSE, empty, 'Nytt')
    expect(readStoryDrafts(s, HASSE)).toEqual([again])
  })

  it('a v1 text written after it was taken over (an older tab) is not the one taken over: shown, not lost', () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: v1Text }))
    const [old] = readStoryDrafts(s, HASSE)
    removeStoryDraft(s, HASSE, old!)
    Object.assign(s.data, v1Store(HASSE, { [whole.id]: 'Skrivet i en äldre flik' }))
    expect(readStoryDrafts(s, HASSE).map(d => d.body)).toEqual(['Skrivet i en äldre flik'])
  })

  it('a failed write takes nothing over: the v1 draft is still there, and nothing was half-written', () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: v1Text }))
    const [old] = readStoryDrafts(s, HASSE)
    const full = { ...s, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
    expect(saveStoryDraft(full, HASSE, { ...old!, body: 'Ändrat' })).toBeNull()
    expect(removeStoryDraft(full, HASSE, old!)).toBe(false)
    expect(readStoryDrafts(s, HASSE)).toEqual([old])
    expect(s.data[v2Key(HASSE)]).toBeUndefined()
  })
})

describe('the Snacket draft is never touched by a Story draft', () => {
  it('writing, confirming, recovering, publishing and throwing away Story drafts leave it exactly as it was', async () => {
    const s = memoryStorage(v1Store(HASSE, { [whole.id]: 'Gammalt' }))
    writePostDraft(s, HASSE, { body: 'Mitt Snacket-utkast', sport: 'hockey', ...attachmentFrom(story([X])) })
    const snacket = s.data[`${POST_DRAFT_KEY}:${HASSE}`]
    const [old] = readStoryDrafts(s, HASSE)
    const confirmed = saveStoryDraft(s, HASSE, { ...old!, ...attachmentPatch(attachmentFrom(whole)) })!
    const fresh = write(s, HASSE, newStoryDraft(story([M])), 'Om Sirius')
    write(s, HASSE, fresh, 'Om Sirius!')
    await publishDraft(s, HASSE, confirmed, [whole])
    removeStoryDraft(s, HASSE, fresh)
    expect(s.data[`${POST_DRAFT_KEY}:${HASSE}`]).toBe(snacket)
    expect(readPostDraft(s, HASSE)).toMatchObject({ body: 'Mitt Snacket-utkast', sport: 'hockey', leadId: X.id })
  })
})

describe('while the news is loading or unavailable', () => {
  it('loading: nothing is said to need recovery yet, and publishing is refused as loading', async () => {
    const s = memoryStorage()
    const d = write(s, HASSE, newStoryDraft(whole), 'Text')
    expect(draftsToRecover([d], [], 'loading')).toEqual([])
    const { r, sent } = await publishDraft(s, HASSE, d, [], { news: 'loading' })
    expect([r, sent]).toEqual([{ ok: false, message: ATTACHMENT_REFUSED.loading }, []])
    expect(readStoryDrafts(s, HASSE)).toEqual([d])
  })

  it('unavailable: a draft no shown Story holds is listed, and refused as unavailable, not missing', async () => {
    const s = memoryStorage()
    const d = write(s, HASSE, newStoryDraft(whole), 'Text')
    expect(draftsToRecover([d], [], 'unavailable')).toEqual([d])
    expect(draftsToRecover([d], [whole], 'unavailable')).toEqual([])
    const { r } = await publishDraft(s, HASSE, d, [], { news: 'unavailable' })
    expect(r).toEqual({ ok: false, message: ATTACHMENT_REFUSED.unavailable })
    expect(readStoryDrafts(s, HASSE)).toEqual([d])
  })
})

describe('per supporter', () => {
  it('each owner reads only their own drafts, v1 and v2, and the guest keeps the original key', () => {
    const s = memoryStorage({ ...v1Store('guest', { [whole.id]: 'Gästens' }), ...v1Store(LOTTA, { [whole.id]: 'Lottas gamla' }) })
    const hasse = write(s, HASSE, newStoryDraft(whole), 'Hasses')
    expect(readStoryDrafts(s, HASSE)).toEqual([hasse])
    expect(readStoryDrafts(s, LOTTA).map(d => d.body)).toEqual(['Lottas gamla'])
    expect(readStoryDrafts(s, 'guest').map(d => d.body)).toEqual(['Gästens'])
    expect(Object.keys(s.data)).toContain(v2Key(HASSE))
  })

  it('taking over one owner\'s v1 draft never takes over another\'s with the same Story id and text', () => {
    const s = memoryStorage({ ...v1Store(HASSE, { [whole.id]: 'Samma' }), ...v1Store(LOTTA, { [whole.id]: 'Samma' }) })
    removeStoryDraft(s, HASSE, readStoryDrafts(s, HASSE)[0]!)
    expect(readStoryDrafts(s, HASSE)).toEqual([])
    expect(readStoryDrafts(s, LOTTA).map(d => d.body)).toEqual(['Samma'])
  })
})

describe('the whole journey', () => {
  it('created, written, closed, reloaded, reopened, account switched, regrouped, published', async () => {
    const s = memoryStorage()
    // Created from the Story card, written in, closed: kept.
    let d = write(s, HASSE, newStoryDraft(whole), 'Rätt beslut')
    // Reload: read back as it was; the card offers to continue it.
    expect(readStoryDrafts(s, HASSE)).toEqual([d])
    expect(draftsAbout(readStoryDrafts(s, HASSE), whole, [whole])).toEqual([d])
    d = write(s, HASSE, readStoryDrafts(s, HASSE)[0]!, 'Rätt beslut, fel timing.')
    // Someone else signs in on this browser: none of it.
    expect(readStoryDrafts(s, LOTTA)).toEqual([])
    // Back as Hasse, after the news regrouped (the earlier article gone, another Story merged in).
    const now = [story([B, I, M, X]), story([O])]
    expect(draftsAbout(readStoryDrafts(s, HASSE), now[0]!, now)).toEqual([d])
    const { r, sent } = await publishDraft(s, HASSE, d, now)
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_body: 'Rätt beslut, fel timing.', p_story: now[0]!.capture!.data })
    expect(readStoryDrafts(s, HASSE)).toEqual([])
  })
})

describe('storage that is unavailable or corrupt is never destroyed', () => {
  it('blocked storage: no drafts read, writing reports it, nothing throws', () => {
    const blocked = { getItem: () => { throw new DOMException('blocked', 'SecurityError') }, setItem: () => { throw new DOMException('blocked', 'SecurityError') } }
    expect(readStoryDrafts(blocked, HASSE)).toEqual([])
    expect(readStoryDrafts(undefined, HASSE)).toEqual([])
    expect(saveStoryDraft(blocked, HASSE, { ...newStoryDraft(whole), body: 'x' })).toBeNull()
    expect(removeStoryDraft(blocked, HASSE, newStoryDraft(whole))).toBe(false)
  })

  it('an unreadable v2 store is kept aside before anything replaces it', () => {
    const s = memoryStorage({ [v2Key(HASSE)]: '{"drafts": [trasig' })
    const d = write(s, HASSE, newStoryDraft(whole), 'Nytt')
    expect(s.data[`${v2Key(HASSE)}:unreadable`]).toBe('{"drafts": [trasig')
    expect(readStoryDrafts(s, HASSE)).toEqual([d])
  })

  it('…and never replaced when it can\'t be kept aside', () => {
    const s = memoryStorage({ [v2Key(HASSE)]: 'trasig', [`${v2Key(HASSE)}:unreadable`]: 'en tidigare' })
    expect(saveStoryDraft(s, HASSE, { ...newStoryDraft(whole), body: 'Nytt' })).toBeNull()
    expect(s.data[v2Key(HASSE)]).toBe('trasig')
  })

  it('entries this version can\'t read are written back untouched', () => {
    const odd = { id: 7, body: ['framtida format'] }
    const s = memoryStorage({ [v2Key(HASSE)]: JSON.stringify({ drafts: [odd], superseded: {} }) })
    expect(readStoryDrafts(s, HASSE)).toEqual([])
    write(s, HASSE, newStoryDraft(whole), 'Nytt')
    expect(JSON.parse(s.data[v2Key(HASSE)]!).drafts).toContainEqual(odd)
  })

  it('a corrupt v1 store is ignored, and never written', () => {
    const s = memoryStorage({ [`${STORY_DRAFTS_V1_KEY}:${HASSE}`]: '{trasig', [`${STORY_DRAFTS_V1_KEY}:${LOTTA}`]: JSON.stringify({ a: 5, b: '', c: 'Kvar' }) })
    expect(readStoryDrafts(s, HASSE)).toEqual([])
    write(s, HASSE, newStoryDraft(whole), 'Nytt')
    expect(s.data[`${STORY_DRAFTS_V1_KEY}:${HASSE}`]).toBe('{trasig')
    expect(readStoryDrafts(s, LOTTA).map(d => d.body)).toEqual(['Kvar'])
  })

  it('attachment fields are text at sane lengths, whatever was stored', () => {
    const s = memoryStorage({ [v2Key(HASSE)]: JSON.stringify({ drafts: [{ id: 'd1', body: 'Text', headline: 'x'.repeat(5000), leadId: 42, updatedAt: '2026-11-14T10:00:00Z' }], superseded: {} }) })
    const [d] = readStoryDrafts(s, HASSE)
    expect(d!.headline).toHaveLength(300)
    expect(d!.leadId).toBeUndefined()
  })
})
