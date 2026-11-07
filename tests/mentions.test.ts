import { describe, expect, it } from 'vitest'
import type { PublicAuthor } from '../shared/utils/profile'
import { createMentionDirectory, insertMention, matchSupporters, MENTION_LIMIT, mentionCandidates, mentionedHandles } from '../app/lib/mentions'
import { sectionLinks } from '../app/lib/sectionLinks'
import { createCaretLookup, findTrigger } from '../app/lib/storyLookup'

/*
 * Mission #18: @mentions. Suggestions come only from authors already on the
 * page; a mention links to a supporter only once it's confirmed; the rest
 * of the text, and ordinary @ text, are left alone.
 */

const lotta: PublicAuthor = { id: 'bbbb-2', name: 'Lotta från Gärdet', handle: 'lotta', avatar: null }
const hasse: PublicAuthor = { id: 'aaaa-1', name: 'Hasse på Söder', handle: 'hasse', avatar: 'stjarna' as PublicAuthor['avatar'] }
const jarn: PublicAuthor = { id: 'cccc-3', name: 'Järnmannen', handle: 'jarnmannen', avatar: null }
const ostermalm: PublicAuthor = { id: 'dddd-4', name: 'Östermalms Lotta', handle: 'blaranden', avatar: null }

describe('who may be suggested', () => {
  it('authors on the page, once each, most recently active first, never yourself', () => {
    expect(mentionCandidates([lotta, hasse, lotta, jarn, hasse])).toEqual([lotta, hasse, jarn])
    expect(mentionCandidates([lotta, hasse, jarn], 'aaaa-1')).toEqual([lotta, jarn])
  })
})

describe('matching the word after @', () => {
  const all = [hasse, lotta, jarn, ostermalm]

  it('handles starting with it first, then names with a word starting with it', () => {
    expect(matchSupporters(all, 'lot')).toEqual([lotta, ostermalm])
    expect(matchSupporters(all, 'LOT')).toEqual([lotta, ostermalm])
  })

  it('ignores accents, so "jarn" and "oster" find Järnmannen and Östermalm', () => {
    expect(matchSupporters(all, 'jarn')).toEqual([jarn])
    expect(matchSupporters(all, 'oster')).toEqual([ostermalm])
    expect(matchSupporters(all, 'Järn')).toEqual([jarn])
  })

  it('a bare @ lists the most recently active, a few at most', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...lotta, id: `id-${i}`, handle: `fan_${i}` }))
    expect(matchSupporters(many, '')).toHaveLength(MENTION_LIMIT)
    expect(matchSupporters(all, '')).toEqual(all)
  })

  it('nothing matching: nothing to suggest', () => {
    expect(matchSupporters(all, 'zlatan')).toEqual([])
  })
})

describe('finding the @word at the caret', () => {
  it('after whitespace, a bracket or at the start', () => {
    expect(findTrigger('Hej @lot', 8, 8, '@')).toEqual({ start: 4, end: 8, query: 'lot' })
    expect(findTrigger('@', 1, 1, '@')).toEqual({ start: 0, end: 1, query: '' })
    expect(findTrigger('(@has', 5, 5, '@')).toEqual({ start: 1, end: 5, query: 'has' })
  })

  it('never inside an e-mail address, or once the word is done', () => {
    expect(findTrigger('mejla hej@dif', 13, 13, '@')).toBeNull()
    expect(findTrigger('Hej @lotta ', 11, 11, '@')).toBeNull()
  })

  it('# and @ never confuse each other', () => {
    expect(findTrigger('Hej @lot', 8)).toBeNull()
    expect(findTrigger('#derby', 6, 6, '@')).toBeNull()
  })
})

describe('the @ suggestions, by keyboard', () => {
  function lookup(candidates = [hasse, lotta, jarn]) {
    const l = createCaretLookup({ mark: '@', search: q => matchSupporters(candidates, q), enabled: () => true })
    const type = (text: string) => l.sync(text, text.length)
    return { l, type }
  }

  it('opens only with someone to suggest: other @ text is just text', () => {
    const { l, type } = lookup()
    type('Hej @zz')
    expect(l.open.value).toBe(false)
    expect(l.key('Enter')).toBe(false) // a new line, as always
    type('mejla hej@dif.se')
    expect(l.open.value).toBe(false)
    type('Hej @l')
    expect(l.open.value).toBe(true)
  })

  it('Enter is a new line until the arrows choose someone', () => {
    const { l, type } = lookup()
    type('Hej @')
    expect(l.key('Enter')).toBe(false)
    expect(l.key('ArrowDown')).toBe(true)
    expect(l.key('ArrowDown')).toBe(true)
    expect(l.key('Enter')).toEqual(lotta)
  })

  it('arrows wrap around', () => {
    const { l, type } = lookup()
    type('@')
    l.key('ArrowUp')
    expect(l.key('Enter')).toEqual(jarn)
  })

  it('Escape closes them for that @ and they stay closed until the caret leaves it', () => {
    const { l, type } = lookup()
    type('Hej @l')
    expect(l.key('Escape')).toBe(true)
    expect(l.open.value).toBe(false)
    type('Hej @lo')
    expect(l.open.value).toBe(false)
    type('Hej @lo ')
    type('Hej @lo @h')
    expect(l.open.value).toBe(true)
  })
})

describe('choosing someone', () => {
  it('puts @handle where @query was and keeps the rest of the draft', () => {
    const text = 'Håller med @lot om derbyt'
    expect(insertMention(text, { start: 11, end: 15 }, 'lotta')).toEqual({ text: 'Håller med @lotta om derbyt', caret: 18 })
  })

  it('adds a space at the end, ready to write on', () => {
    expect(insertMention('Tack @has', { start: 5, end: 9 }, 'hasse')).toEqual({ text: 'Tack @hasse ', caret: 12 })
    expect(insertMention('@', { start: 0, end: 1 }, 'hasse')).toEqual({ text: '@hasse ', caret: 7 })
  })

  it('replaces the whole word even when the caret was in its middle', () => {
    expect(insertMention('Hej @lotxyz!', { start: 4, end: 11 }, 'lotta').text).toBe('Hej @lotta !')
  })
})

describe('which mentions could be someone', () => {
  it('handles in the text, once each, lowercase', () => {
    expect(mentionedHandles('Hej @Lotta och @hasse, @lotta igen')).toEqual(['lotta', 'hasse'])
  })

  it('not e-mail addresses, and not words no handle can be', () => {
    expect(mentionedHandles('mejla hej@dif.se')).toEqual([])
    expect(mentionedHandles('@ab är för kort, @åsa har å, @a_very_long_handle_over_20')).toEqual([])
  })
})

/** A stand-in for the Supabase client: profiles and aliases readable as the database's rules allow. */
function fakeClient(db: { profiles: Array<{ id: string, display_name: string, handle: string, avatar: string | null }>, aliases: Array<{ handle: string, profile_id: string }> }, opts: { fail?: boolean, gate?: Promise<void> } = {}) {
  const calls: string[] = []
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            async in(column: string, values: string[]) {
              calls.push(`${table}.${column}:${values.join(',')}`)
              await opts.gate
              if (opts.fail) return { data: null, error: { code: 'XX000' } }
              const rows = table === 'profiles' ? db.profiles : db.aliases
              return { data: rows.filter(r => values.includes((r as Record<string, string>)[column === 'id' ? 'id' : 'handle']!)), error: null }
            },
          }
        },
      }
    },
  }
  return { client: client as never, calls }
}

const DB = {
  profiles: [
    { id: 'eeee-5', display_name: 'Tyst Supporter', handle: 'tystnaden', avatar: null },
    { id: 'ffff-6', display_name: 'Nya Namnet', handle: 'nyanamnet', avatar: 'stjarna' },
  ],
  // ffff-6 used to be @gamlanamnet: the alias stays theirs for good.
  aliases: [{ handle: 'gamlanamnet', profile_id: 'ffff-6' }],
}

const runNow = (run: () => void) => run()
const settle = () => new Promise(r => setTimeout(r, 0))

describe('which mentions become links', () => {
  it('an author already on the page: a link at once, no request', () => {
    const { client, calls } = fakeClient(DB)
    const d = createMentionDirectory(client, { known: () => [lotta], schedule: runNow })
    d.request(['Lotta'])
    expect(d.target('lotta')).toEqual(lotta)
    expect(d.target('LOTTA')).toEqual(lotta)
    expect(calls).toEqual([])
  })

  it('a supporter not on the page: looked up by that exact handle, in one batch', async () => {
    const { client, calls } = fakeClient(DB)
    const d = createMentionDirectory(client, { known: () => [], schedule: runNow })
    d.request(['tystnaden', 'okand'])
    await settle()
    expect(d.target('tystnaden')).toMatchObject({ id: 'eeee-5', handle: 'tystnaden', name: 'Tyst Supporter' })
    expect(calls[0]).toBe('profiles.handle:tystnaden,okand')
  })

  it('a former handle leads to the supporter it belongs to, at their current address', async () => {
    const { client } = fakeClient(DB)
    const d = createMentionDirectory(client, { known: () => [], schedule: runNow })
    d.request(['gamlanamnet'])
    await settle()
    const t = d.target('gamlanamnet')!
    expect(t).toMatchObject({ id: 'ffff-6', handle: 'nyanamnet' })
    expect(sectionLinks('/snacket').supporter(t.handle)).toBe('/laktaren/nyanamnet')
  })

  it('unknown or not public: stays text, and is asked about only once', async () => {
    const { client, calls } = fakeClient(DB)
    const d = createMentionDirectory(client, { known: () => [], schedule: runNow })
    d.request(['okand'])
    await settle()
    d.request(['okand'])
    await settle()
    expect(d.target('okand')).toBeNull()
    expect(calls.filter(c => c.includes('okand'))).toEqual(['profiles.handle:okand', 'profile_handle_aliases.handle:okand'])
  })

  it('words that can’t be a handle never reach the database', async () => {
    const { client, calls } = fakeClient(DB)
    const d = createMentionDirectory(client, { known: () => [], schedule: runNow })
    d.request(['ab', 'åsa', 'x'.repeat(30)])
    await settle()
    expect(calls).toEqual([])
  })

  it('no connection to the database: everything stays text, and may be asked again', async () => {
    const failing = fakeClient(DB, { fail: true })
    const d = createMentionDirectory(failing.client, { known: () => [], schedule: runNow })
    d.request(['tystnaden'])
    await settle()
    expect(d.target('tystnaden')).toBeNull()
    d.request(['tystnaden'])
    await settle()
    expect(failing.calls.filter(c => c.startsWith('profiles.handle'))).toHaveLength(2)
    expect(createMentionDirectory(null, { known: () => [] }).target('tystnaden')).toBeNull()
  })

  it('a new account forgets what the last one was told, including answers still on their way', async () => {
    let open!: () => void
    const gate = new Promise<void>(r => (open = r))
    const { client } = fakeClient(DB, { gate })
    const d = createMentionDirectory(client, { known: () => [], schedule: runNow })
    d.request(['tystnaden'])
    d.reset() // signed out (or in as someone else) before the answer came
    open()
    await settle()
    expect(d.target('tystnaden')).toBeNull()
    expect(d.confirmed.value).toEqual({})
  })

  it('after an account change, handles are asked about again, as the new viewer', async () => {
    const { client, calls } = fakeClient(DB)
    const d = createMentionDirectory(client, { known: () => [], schedule: runNow })
    d.request(['tystnaden'])
    await settle()
    d.reset()
    expect(d.target('tystnaden')).toBeNull()
    d.request(['tystnaden'])
    await settle()
    expect(d.target('tystnaden')).toMatchObject({ handle: 'tystnaden' })
    expect(calls.filter(c => c === 'profiles.handle:tystnaden')).toHaveLength(2)
  })

  it('links go to the supporter’s page by their handle', () => {
    expect(sectionLinks('/').supporter(lotta.handle)).toBe('/laktaren/lotta')
  })
})
