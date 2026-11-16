import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { queryForSort, sortFromQuery } from '../app/lib/feedSort'

/* Snacket's tab in the address (?sort=…), so a refresh, a link and back/forward show the same tab. */

describe('reading the tab from the address', () => {
  it('names a tab, or none', () => {
    expect(sortFromQuery('hetast')).toBe('hetast')
    expect(sortFromQuery('nyast')).toBe('nyast')
    expect(sortFromQuery('foljer')).toBe('foljer')
    expect(sortFromQuery(undefined)).toBeNull()
  })

  it('anything unknown is no tab (and so Nyast), never an error', () => {
    for (const bad of ['', 'Foljer', 'följer', 'popular', '1', null, 42, {}]) expect(sortFromQuery(bad), String(bad)).toBeNull()
  })

  it('a repeated parameter: the first one', () => {
    expect(sortFromQuery(['foljer', 'hetast'])).toBe('foljer')
  })
})

describe('writing the tab into the address', () => {
  it('Nyast is the plain address; the others say so', () => {
    expect(queryForSort({ sort: 'foljer' }, 'nyast')).toEqual({})
    expect(queryForSort({}, 'foljer')).toEqual({ sort: 'foljer' })
    expect(queryForSort({ sort: 'foljer' }, 'hetast')).toEqual({ sort: 'hetast' })
  })

  it('keeps every other parameter as it was', () => {
    expect(queryForSort({ utm_source: 'mejl', tag: ['a', 'b'], sort: 'x' }, 'foljer')).toEqual({ utm_source: 'mejl', tag: ['a', 'b'], sort: 'foljer' })
    expect(queryForSort({ utm_source: 'mejl', sort: 'hetast' }, 'nyast')).toEqual({ utm_source: 'mejl' })
  })
})

describe('Snacket keeps one state and mirrors it', () => {
  const section = readFileSync('app/components/SnacketSection.vue', 'utf8').replace(/\r\n/g, '\n')
  const snacket = readFileSync('app/composables/useSnacket.ts', 'utf8')

  it('the tab is still the one `snacket-sort` state; the address only mirrors it', () => {
    expect(snacket).toContain("useState<FeedSort>('snacket-sort', () => 'nyast')")
    expect(section.match(/useState/g)).toBeNull()
  })

  it('arriving: the address is read only in the browser, once mounted (the CDN caches /snacket whatever its query)', () => {
    const mounted = section.slice(section.indexOf('onMounted(async () => {'))
    expect(mounted).toMatch(/^onMounted\(async \(\) => \{\n {2}const want = sortFromQuery\(route\.query\.sort\)/)
    expect(mounted).toContain('await router.replace({ query: queryForSort(route.query, want), hash: route.hash })')
    // Nothing sets the tab from the address during setup (that would run on the server too)
    expect(section).not.toMatch(/^if \(.*route\.query/m)
  })

  it('picking a tab pushes a history entry; back/forward set the tab from the address', () => {
    expect(section).toContain('watch(sort, (s) => {\n  if (!agrees(s)) void router.push({ query: queryForSort(route.query, s) })')
    expect(section).toContain('watch(() => route.query.sort, () => {\n  if (inAddress() !== sort.value) sort.value = inAddress()')
  })
})
