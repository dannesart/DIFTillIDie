import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStore } from '../app/lib/auth'
import type { SourceArticle, Story } from '../shared/types/domain'
import type { DraftAttachment, NewsLoad, PostDraft } from '../app/lib/postDraft'
import { ATTACHMENT_REFUSED, attachmentFrom, attachmentPatch, discardPostDraft, draftAttachment, keepsPostDraft, newsLoad, postDraftPreview, readPostDraft, resolveAttachment, writePostDraft } from '../app/lib/postDraft'
import { createCommunity } from '../app/lib/posts'
import { article } from './helpers'

/*
 * A Snacket draft's attached Story (Issue #25). The draft keeps the article the supporter chose (its lead
 * then) and that headline; publishing checks it against the Stories as they are right then, and refuses a
 * post whose Story can't be confirmed instead of publishing it without one (the bug: p_story null).
 */

const HASSE = '22222222-2222-4222-8222-222222222222'

/** Supabase, as far as publishing goes: every publish_post call recorded. */
function fakeClient() {
  const sent: Record<string, unknown>[] = []
  const client = {
    rpc(_fn: string, args: Record<string, unknown>) {
      sent.push(args)
      return { select: () => ({ single: async () => ({ data: { id: `p-${sent.length}`, body: args.p_body, sport: null, story_id: null, created_at: '2026-11-14T10:00:00Z', author: { id: HASSE, display_name: 'Hovet-Hasse', handle: 'hovethasse' } }, error: null }) }) }
    },
  }
  return { client: client as unknown as SupabaseClient, sent }
}
const auth = { status: ref('signed-in'), profileStatus: ref('ready'), profile: ref({ id: HASSE, displayName: 'Hovet-Hasse', handle: 'hovethasse' }), userId: ref(HASSE) } as unknown as AuthStore

const at = (h: number) => new Date(Date.UTC(2026, 10, 9, 22) + h * 3_600_000).toISOString()
// Shaped like the real 13 November Story: the earliest article (A) is another event than the lead (I)
const A = article({ headline: 'Expert: tränaren lämnar efter säsongen', publishedAt: at(0), reporting: 'compiled', outlet: 'Bollsvenskan' })
const B = article({ headline: 'Officiellt: tränaren sparkas', publishedAt: at(12), reporting: 'compiled', outlet: 'Bollsvenskan' })
const I = article({ headline: 'Sportchefen förklarar varför tränaren sparkades', publishedAt: at(37), reporting: 'original', outlet: 'Sportbladet' })
const M = article({ headline: 'Inför bortamatchen mot Sirius', publishedAt: at(47), reporting: 'compiled', outlet: 'Bollsvenskan' })
const X = article({ headline: 'Klubben bekräftar: ny sportchef på plats', publishedAt: at(30), reporting: 'original', outlet: 'Expressen' })

/** A Story as the server sends it: id from the earliest article, original reporting leads, with a capture. */
function story(sources: SourceArticle[]): Story {
  const s = [...sources].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt))
  const id = `story-${s[0]!.id}`
  return { id, sport: 'fotboll', sources: s, leadId: (s.find(a => a.reporting === 'original') ?? s[0]!).id, sharedNames: [], updatedAt: s.at(-1)!.publishedAt, capture: { data: `{"storyId":"${id}"}`, sig: `sig-${id}` } }
}

const whole = story([A, B, I, M])
// The supporter chose the whole Story while it was one: its lead was I
const chosen: DraftAttachment = attachmentFrom(whole)
const draft: PostDraft = { body: 'Rätt beslut, fel timing.', sport: 'fotboll', ...chosen }

async function publishDraft(d: PostDraft, stories: Story[], news: NewsLoad = 'ready') {
  const { client, sent } = fakeClient()
  const r = await createCommunity(client, auth).publish({ body: d.body, sport: d.sport, attach: { attachment: draftAttachment(d), stories, news } })
  return { r, sent }
}

describe('what a chosen Story keeps', () => {
  it('the article whose headline was shown, that headline and outlet, and the Story id then', () => {
    expect(chosen).toEqual({ storyId: whole.id, leadId: I.id, headline: I.headline, outlet: 'Sportbladet' })
  })

  it('choosing another Story replaces every part of the attachment, never mixing two', () => {
    const old: PostDraft = { body: 'Text', storyId: 'story-old', leadId: 'old-lead', headline: 'Gammal rubrik', outlet: 'Gammal källa' }
    const other = story([M])
    expect({ ...old, ...attachmentPatch(attachmentFrom(other)) }).toEqual({ body: 'Text', storyId: other.id, leadId: M.id, headline: M.headline, outlet: M.outlet })
  })

  it('removing it clears every part together, and leaves the text', () => {
    const removed = { ...draft, ...attachmentPatch(undefined) }
    expect(draftAttachment(removed)).toBeUndefined()
    expect([removed.body, removed.storyId, removed.leadId, removed.headline, removed.outlet]).toEqual([draft.body, undefined, undefined, undefined, undefined])
    expect({ ...draft, ...discardPostDraft(draft) }).toMatchObject({ body: '', storyId: undefined, leadId: undefined, headline: undefined, outlet: undefined })
  })
})

describe('publishing never drops a Story the draft is about (the bug)', () => {
  it('a chosen article no longer in the feeds: refused, nothing sent, never p_story null', async () => {
    const { r, sent } = await publishDraft(draft, [story([M])])
    expect(r).toEqual({ ok: false, message: ATTACHMENT_REFUSED.missing })
    expect(sent).toEqual([])
  })

  it('refusing keeps the whole draft: text and every part of the attachment', async () => {
    const storage = new Map<string, string>()
    const s = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) }
    writePostDraft(s, `account:${HASSE}`, draft)
    const before = readPostDraft(s, `account:${HASSE}`)
    const { r } = await publishDraft(before, [])
    expect(r.ok).toBe(false)
    expect(readPostDraft(s, `account:${HASSE}`)).toEqual(before)
    expect(before).toMatchObject(draft)
  })

  it('removing the Story on purpose publishes an ordinary post', async () => {
    const { r, sent } = await publishDraft({ ...draft, ...attachmentPatch(undefined) }, [story([M])])
    expect(r.ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ p_body: draft.body, p_story: null, p_story_sig: null })
  })

  it('a draft that never had a Story is a normal post', async () => {
    const { r, sent } = await publishDraft({ body: 'Bara text', sport: 'hockey' }, [])
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_story: null })
  })

  it('checks right before sending: a Story that changed since the composer opened is checked as it is now', async () => {
    // Open: the article is there. Then the feeds move on, and it isn't.
    expect(resolveAttachment(chosen, [whole], 'ready').kind).toBe('attached')
    const { r, sent } = await publishDraft(draft, [story([A, B, M])])
    expect(r).toEqual({ ok: false, message: ATTACHMENT_REFUSED.missing })
    expect(sent).toEqual([])
  })
})

describe('the chosen article, wherever it is now', () => {
  it('after a split: the part holding the chosen article, not the earliest article\'s', async () => {
    const parts = [story([A]), story([B, I]), story([M])]
    expect(parts[0]!.id).toBe(chosen.storyId)
    expect(resolveAttachment(chosen, parts, 'ready')).toEqual({ kind: 'attached', story: parts[1], changed: false })
    const { r, sent } = await publishDraft(draft, parts)
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_story: parts[1]!.capture!.data, p_story_sig: parts[1]!.capture!.sig })
  })

  it('after a merge: the merged Story, said to have changed when it shows another headline', async () => {
    const merged = story([A, B, I, M, X])
    expect(merged.leadId).toBe(X.id)
    expect(resolveAttachment(chosen, [merged], 'ready')).toEqual({ kind: 'attached', story: merged, changed: true })
    const { r, sent } = await publishDraft(draft, [merged])
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_story: merged.capture!.data })
  })

  it('the same Story with its own headline: not changed', () => {
    expect(resolveAttachment(chosen, [whole], 'ready')).toEqual({ kind: 'attached', story: whole, changed: false })
  })

  it('a chosen article that left the feeds is never looked for by the old Story id', async () => {
    // The old id still answers (the earliest article is there), but the chosen article is gone
    const live = [story([A, B, M])]
    expect(live[0]!.id).toBe(chosen.storyId)
    expect(resolveAttachment(chosen, live, 'ready')).toEqual({ kind: 'missing' })
    expect((await publishDraft(draft, live)).sent).toEqual([])
  })
})

describe('while the news is loading or unavailable, a Story is never taken for gone', () => {
  it('loading: refused as loading, the attachment kept', async () => {
    expect(resolveAttachment(chosen, [], 'loading')).toEqual({ kind: 'loading' })
    const { r, sent } = await publishDraft(draft, [], 'loading')
    expect([r, sent]).toEqual([{ ok: false, message: ATTACHMENT_REFUSED.loading }, []])
  })

  it('unavailable: refused as unavailable, not as missing', async () => {
    expect(resolveAttachment(chosen, [], 'unavailable')).toEqual({ kind: 'unavailable' })
    const { r, sent } = await publishDraft(draft, [], 'unavailable')
    expect([r, sent]).toEqual([{ ok: false, message: ATTACHMENT_REFUSED.unavailable }, []])
  })

  it('a Story still among the news shown, even if the latest fetch failed, is attached', () => {
    expect(resolveAttachment(chosen, [whole], 'unavailable').kind).toBe('attached')
  })

  it('maps the news request\'s status', () => {
    expect([newsLoad('success'), newsLoad('error'), newsLoad('pending'), newsLoad('idle'), newsLoad(undefined)]).toEqual(['ready', 'unavailable', 'loading', 'loading', 'loading'])
  })
})

describe('a draft from before the chosen article was kept (v1)', () => {
  const v1: PostDraft = { body: 'Gammalt utkast', storyId: whole.id }

  it('is read as it was, and kept', () => {
    const s = { getItem: () => JSON.stringify({ body: 'Gammalt utkast', sport: 'fotboll', storyId: whole.id }) }
    expect(readPostDraft(s, `account:${HASSE}`)).toEqual({ body: 'Gammalt utkast', sport: 'fotboll', storyId: whole.id })
    expect(keepsPostDraft(v1)).toBe(true)
  })

  it('needs its Story confirmed before publishing, even when its old id still finds one', async () => {
    expect(resolveAttachment(draftAttachment(v1), [whole], 'ready')).toEqual({ kind: 'confirm', story: whole })
    const { r, sent } = await publishDraft(v1, [whole])
    expect([r, sent]).toEqual([{ ok: false, message: ATTACHMENT_REFUSED.confirm }, []])
  })

  it('confirmed, it is the chosen article from then on, and publishes with that Story', async () => {
    const confirmed = { ...v1, ...attachmentPatch(attachmentFrom(whole)) }
    expect(confirmed.leadId).toBe(I.id)
    const { r, sent } = await publishDraft(confirmed, [whole])
    expect(r.ok).toBe(true)
    expect(sent[0]).toMatchObject({ p_story: whole.capture!.data })
  })

  it('whose Story is gone: refused as missing, with nothing to show but that it was a Story', async () => {
    expect(resolveAttachment(draftAttachment(v1), [story([M])], 'ready')).toEqual({ kind: 'missing' })
    expect(postDraftPreview({ ...v1, body: '' })).toBe('En Story bifogad')
  })
})

describe('stored per supporter, as before', () => {
  const memory = () => {
    const data: Record<string, string> = {}
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v }, removeItem: (k: string) => { delete data[k] } }
  }

  it('one supporter\'s attachment never reaches another\'s draft, or a guest', () => {
    const s = memory()
    writePostDraft(s, `account:${HASSE}`, draft)
    expect(readPostDraft(s, 'account:someone-else')).toEqual({ body: '' })
    expect(readPostDraft(s, 'guest')).toEqual({ body: '' })
    expect(readPostDraft(s, `account:${HASSE}`)).toEqual(draft)
  })

  it('keeps only text in the attachment fields, at sane lengths', () => {
    const s = { getItem: () => JSON.stringify({ body: 'x', storyId: 's', leadId: 42, headline: 'h'.repeat(1000), outlet: { o: 1 } }) }
    const d = readPostDraft(s, `account:${HASSE}`)
    expect([d.leadId, d.headline!.length, d.outlet]).toEqual([undefined, 300, undefined])
  })

  it('the entry shows the chosen headline of a draft that is only a Story', () => {
    expect(postDraftPreview({ body: '', ...chosen }, chosen.headline)).toBe(`Om: ${I.headline}`)
  })
})
