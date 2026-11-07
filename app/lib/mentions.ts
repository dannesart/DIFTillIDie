import type { SupabaseClient } from '@supabase/supabase-js'
import { ref } from 'vue'
import type { AuthorRow, PublicAuthor } from '#shared/utils/profile'
import { HANDLE_PATTERN, toAuthor } from '#shared/utils/profile'
import type { LookupTrigger } from './storyLookup'
import { fold } from './storyLookup'

/*
 * @mentions: suggesting supporters while writing, and turning a mention in
 * a published post or comment into a link to that supporter's page.
 *
 * Nothing here is a directory of supporters. Suggestions come only from the
 * authors of the posts and comments already loaded on the page, who are
 * public by definition (a profile is readable once its supporter has posted
 * or commented). A mention is a link only once it's confirmed to belong to
 * a supporter the viewer may see: one of those authors, or a lookup of that
 * exact handle (their current one, or a former one through its permanent
 * alias), answered by the database under its own visibility rules. Anything
 * else stays text, and nothing about it is revealed.
 */

/** Suggestions at the caret: few enough that the popup never needs to scroll. */
export const MENTION_LIMIT = 5

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * The supporters that may be suggested, from authors seen on the page, most
 * recently active first (pass them newest first). One entry per supporter,
 * as they're called now; never yourself.
 */
export function mentionCandidates(authors: PublicAuthor[], self?: string | null): PublicAuthor[] {
  const seen = new Set<string>()
  const out: PublicAuthor[] = []
  for (const a of authors) {
    if (seen.has(a.id) || a.id === self) continue
    seen.add(a.id)
    out.push(a)
  }
  return out
}

/**
 * Supporters for the word after `@`: their handle starting with it first,
 * then their name having a word that starts with it ("lot" finds @lotta and
 * "Lotta från Gärdet"). A bare `@` lists the most recently active.
 */
export function matchSupporters(candidates: PublicAuthor[], query: string, limit = MENTION_LIMIT): PublicAuthor[] {
  const q = fold(query)
  if (!q) return candidates.slice(0, limit)
  const byHandle = candidates.filter(c => c.handle.startsWith(q))
  const byName = candidates.filter(c => !c.handle.startsWith(q) && words(c.name).some(w => w.startsWith(q)))
  return [...byHandle, ...byName].slice(0, limit)
}

/**
 * Put `@handle` where the `@query` was, the rest of the text untouched, with
 * a space after it (unless one is already there). The caret goes after the space.
 */
export function insertMention(text: string, t: Pick<LookupTrigger, 'start' | 'end'>, handle: string): { text: string, caret: number } {
  const after = text.slice(t.end)
  const tag = `@${handle}`
  const space = /^\s/.test(after) ? '' : ' '
  return { text: text.slice(0, t.start) + tag + space + after, caret: t.start + tag.length + 1 }
}

/** The handles a text mentions that could be someone's (lowercase, once each). */
export function mentionedHandles(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_]+)/gu)) {
    const h = m[2]!.toLowerCase()
    if (HANDLE_PATTERN.test(h)) out.add(h)
  }
  return [...out]
}

interface DataError { code?: string }
const AUTHOR_COLUMNS = 'id, display_name, handle, avatar'
/** Before 20261105220958_supporter_profiles: a database without avatars answers 42703. */
const AUTHOR_COLUMNS_BEFORE_DESIGN = 'id, display_name, handle'
/** A database without aliases yet has none. */
const noAliasTable = (e: unknown) => ['42P01', 'PGRST205'].includes((e as DataError | null)?.code ?? '')
/** At most this many handles per request. */
const BATCH = 50

/**
 * Which mentioned handles are supporters the viewer may see. `known` are the
 * authors already on the page (no request needed); other handles are looked
 * up once each, in batches, as their links render. Answers are the
 * viewer's own (you can always see your own profile), so `reset()` forgets
 * them when the account changes.
 */
export function createMentionDirectory(client: SupabaseClient | null, opts: { known: () => PublicAuthor[], schedule?: (run: () => void) => void }) {
  /** handle (lowercase) → the supporter, or null: not a supporter the viewer may see. */
  const confirmed = ref<Record<string, PublicAuthor | null>>({})
  const asked = new Set<string>()
  let queue: string[] = []
  let scheduled = false
  let generation = 0
  const schedule = opts.schedule ?? (run => setTimeout(run, 30))

  /** The supporter a mention of `handle` is, if confirmed. */
  function target(handle: string): PublicAuthor | null {
    const h = handle.toLowerCase()
    return opts.known().find(a => a.handle === h) ?? confirmed.value[h] ?? null
  }

  /** Ask about handles not known yet (once each, batched). */
  function request(handles: string[]) {
    if (!client) return
    for (const raw of handles) {
      const h = raw.toLowerCase()
      if (!HANDLE_PATTERN.test(h) || asked.has(h) || opts.known().some(a => a.handle === h)) continue
      asked.add(h)
      queue.push(h)
    }
    if (queue.length && !scheduled) {
      scheduled = true
      schedule(() => void flush())
    }
  }

  async function authorsWhere(column: 'handle' | 'id', values: string[]): Promise<PublicAuthor[]> {
    const select = (cols: string) => client!.from('profiles').select(cols).in(column, values)
    let { data, error } = await select(AUTHOR_COLUMNS)
    if ((error as DataError | null)?.code === '42703') ({ data, error } = await select(AUTHOR_COLUMNS_BEFORE_DESIGN))
    if (error) throw error
    return ((data ?? []) as unknown as AuthorRow[]).map(toAuthor)
  }

  async function lookUp(handles: string[], mine: number) {
    const found: Record<string, PublicAuthor | null> = {}
    const current = await authorsWhere('handle', handles)
    for (const a of current) found[a.handle] = a
    // Not anyone's handle now: perhaps a former one, which stays theirs for good.
    const rest = handles.filter(h => !found[h])
    if (rest.length) {
      const { data, error } = await client!.from('profile_handle_aliases').select('handle, profile_id').in('handle', rest)
      if (error && !noAliasTable(error)) throw error
      const aliases = (data ?? []) as { handle: string, profile_id: string }[]
      const owners = aliases.length ? await authorsWhere('id', [...new Set(aliases.map(a => a.profile_id))]) : []
      for (const a of aliases) found[a.handle] = owners.find(o => o.id === a.profile_id) ?? null
    }
    for (const h of handles) found[h] ??= null
    // Answers for an account that has since changed are dropped.
    if (mine === generation) confirmed.value = { ...confirmed.value, ...found }
  }

  async function flush() {
    scheduled = false
    const mine = generation
    const all = queue
    queue = []
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH)
      try { await lookUp(batch, mine) }
      // Couldn't ask: they stay text, and may be asked again on the next visit.
      catch { if (mine === generation) for (const h of batch) asked.delete(h) }
    }
  }

  /** Someone else is looking now: forget what the last account was told. */
  function reset() {
    generation++
    confirmed.value = {}
    asked.clear()
    queue = []
  }

  return { confirmed, target, request, reset }
}

export type MentionDirectory = ReturnType<typeof createMentionDirectory>
