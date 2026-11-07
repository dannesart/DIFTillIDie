import { computed, ref } from 'vue'
import type { Story } from '#shared/types/domain'

/*
 * Finding a Story to attach to a post, from the Stories already loaded.
 * Never fetches anything and never invents a suggestion.
 *
 * Two ways in, one list:
 *  - "Bifoga": a button with a search field. No syntax to know.
 *  - `#` in the post is a hashtag first. A bare `#` offers a few of the
 *    latest Stories; the text after it narrows them down, and when no
 *    Story matches the suggestions simply go away. The text stays an
 *    ordinary hashtag unless a suggestion is actively chosen (arrow keys +
 *    Enter, or a tap). Enter on its own is still a new line, so writing
 *    #derby and carrying on never attaches anything by accident.
 */

/** The `#word` (or `@word`) around the caret that the suggestions are for. */
export interface LookupTrigger {
  /** Index of the `#` (or `@`). */
  start: number
  /** End of the word (it may continue past the caret). */
  end: number
  query: string
}

const WORD = /[\p{L}\p{N}_]/u
/**
 * A `#` (or `@`) starts a lookup at the start of the text, after whitespace
 * or an opening bracket; so an e-mail address (`hej@dif.se`) never does.
 */
const BEFORE_MARK = /[\s([{"'“‘]/u

export function findTrigger(text: string, caret: number, selectionEnd = caret, mark: '#' | '@' = '#'): LookupTrigger | null {
  if (selectionEnd !== caret || caret < 1 || caret > text.length) return null
  // Walk back over the word to its mark.
  let i = caret
  while (i > 0 && WORD.test(text[i - 1]!)) i--
  const start = i - 1
  if (start < 0 || text[start] !== mark) return null
  if (start > 0 && !BEFORE_MARK.test(text[start - 1]!)) return null
  let end = caret
  while (end < text.length && WORD.test(text[end]!)) end++
  const query = text.slice(start + 1, end)
  // A bare `#` counts too: it lists the latest Stories straight away.
  return { start, end, query }
}

/**
 * Take the `#query` out of the text once a Story is chosen for it, without
 * leaving a double space. The caret goes where the token was.
 */
export function removeTrigger(text: string, t: Pick<LookupTrigger, 'start' | 'end'>): { text: string, caret: number } {
  const { start } = t
  let { end } = t
  const before = text[start - 1]
  if (text[end] === ' ' && (start === 0 || before === ' ' || before === '\n')) end++
  return { text: text.slice(0, start) + text.slice(end), caret: start }
}

/** Case- and accent-insensitive, so "malmo" finds "Malmö". */
export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const terms = (q: string) => fold(q).split(/[\s_]+/u).flatMap(words)

function leadOf(story: Story) {
  return story.sources.find(s => s.id === story.leadId) ?? story.sources[0]!
}

/** The `#` suggestions: three at most, so the popup at the caret never needs to scroll. */
export const INLINE_LIMIT = 3

/**
 * Stories whose own headlines or outlets contain every word of the query
 * (word starts: "derb" finds "Derbyt"). The lead headline matching ranks
 * first; otherwise the most recently updated first. An empty query lists
 * the latest Stories. No limit by default: "Bifoga" searches them all.
 */
export function matchStories(stories: Story[], query: string, limit = Infinity): Story[] {
  const newest = [...stories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const want = terms(query)
  if (!want.length) return newest.slice(0, limit)
  const hits = (hay: string[]) => want.every(t => hay.some(w => w.startsWith(t)))
  const lead: Story[] = []
  const other: Story[] = []
  for (const s of newest) {
    if (hits(words(leadOf(s).headline))) lead.push(s)
    else if (hits(s.sources.flatMap(a => [...words(a.headline), ...words(a.outlet), ...words(a.publisher)]))) other.push(s)
  }
  return [...lead, ...other].slice(0, limit)
}

/**
 * Which suggestion is active. None until the arrow keys are used, so Enter
 * keeps meaning "new line" in the post text.
 */
export function moveActive(active: number, delta: 1 | -1, count: number): number {
  if (!count) return -1
  if (active < 0) return delta > 0 ? 0 : count - 1
  return (active + delta + count) % count
}

/**
 * Suggestions at the caret, for the word after a mark (`#` Stories, `@`
 * supporters): what's open, what's active, and what dismissing does. The
 * component feeds it the text and caret after every input, click and caret
 * move. Only open with something to suggest, so a `#tag` or an `@` that
 * matches nothing is just text; Enter only chooses once arrows made a
 * suggestion active.
 */
export function createCaretLookup<T>(opts: { mark: '#' | '@', search: (query: string) => T[], enabled: () => boolean }) {
  const trigger = ref<LookupTrigger | null>(null)
  const active = ref(-1)
  /** The mark (by position) Escape was pressed on; it stays quiet until the caret leaves it. */
  let dismissed: number | null = null

  const results = computed(() => (trigger.value ? opts.search(trigger.value.query) : []))
  const open = computed(() => !!trigger.value && opts.enabled() && results.value.length > 0)

  function sync(text: string, caret: number, selectionEnd = caret) {
    const t = findTrigger(text, caret, selectionEnd, opts.mark)
    if (!t) dismissed = null
    const next = t && t.start !== dismissed ? t : null
    if (next?.start !== trigger.value?.start || next?.query !== trigger.value?.query) active.value = -1
    trigger.value = next
  }

  function close() {
    trigger.value = null
    active.value = -1
  }

  function dismiss() {
    if (trigger.value) dismissed = trigger.value.start
    close()
  }

  /**
   * Arrow keys move, Enter chooses the active one (only once arrows made
   * one active), Escape dismisses. Returns the suggestion chosen with Enter,
   * `true` if the key was used, or `false` to let it do its usual thing.
   */
  function key(k: string): T | boolean {
    if (!open.value) return false
    const n = results.value.length
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      active.value = moveActive(active.value, k === 'ArrowDown' ? 1 : -1, n)
      return true
    }
    if (k === 'Enter') return active.value >= 0 ? results.value[active.value]! : false
    if (k === 'Escape') {
      dismiss()
      return true
    }
    return false
  }

  return { trigger, active, results, open, sync, close, dismiss, key }
}

/** The `#` suggestions in the post text: up to three Stories, for the word after the `#`. */
export function createInlineLookup(opts: { stories: () => Story[], enabled: () => boolean }) {
  const lookup = createCaretLookup({ mark: '#', search: q => matchStories(opts.stories(), q, INLINE_LIMIT), enabled: opts.enabled })

  /** Choose a Story: the `#query` leaves the text, the rest stays, the caret goes where it was. */
  function choose(text: string, story: Story): { text: string, caret: number, storyId: string } | null {
    const t = lookup.trigger.value
    if (!t) return null
    const r = removeTrigger(text, t)
    lookup.close()
    return { ...r, storyId: story.id }
  }

  return { ...lookup, choose }
}
