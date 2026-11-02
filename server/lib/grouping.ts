import type { SourceArticle, Story } from '../../shared/types/domain'
import { fold, slugWords } from './news'

/*
 * Grouping SourceArticles into Stories — deliberately conservative.
 *
 * Two articles are linked only when ALL of these hold:
 *   1. same sport,
 *   2. published within WINDOW_HOURS of each other,
 *   3. they share at least MIN_SHARED distinctive names (people, clubs,
 *      places — capitalised words from headlines/teasers, minus generic ones),
 *   4. at least one of those shared names is in BOTH headlines.
 *
 * Linked articles form a Story (single-linkage). Anything we can't link
 * stays its own Story — a Story with one source is perfectly valid.
 * We never write a headline: the earliest source's own headline leads.
 */

export const WINDOW_HOURS = 24
export const MIN_SHARED = 2

/** Capitalised words that are not names: sentence starters, generic nouns, our own club. */
const GENERIC = new Set([
  // our own club, leagues, countries, generic sports words
  'djurgarden', 'djurgarn', 'dif', 'allsvenskan', 'superettan', 'shl', 'hockeyallsvenskan', 'sverige', 'svensk', 'svenska', 'stockholm',
  'var', 'vm', 'em', 'os', 'nhl', 'uefa', 'fifa', 'europa', 'conference', 'league', 'cup', 'cupen', 'derbyt', 'derby',
  // sentence starters and common capitalised words
  'det', 'den', 'de', 'dar', 'darfor', 'sa', 'nu', 'nar', 'klart', 'officiellt', 'uppgifter', 'efter', 'infor', 'mot', 'han', 'hon', 'vi', 'jag',
  'ni', 'man', 'ny', 'nya', 'fem', 'tre', 'tva', 'veckan', 'analys', 'kronika', 'just', 'har', 'inte', 'alla', 'ingen', 'nar', 'vem', 'vad', 'hur',
  'en', 'ett', 'och', 'i', 'pa', 'av', 'med', 'for', 'till', 'om', 'utan', 'trots', 'kan', 'ska', 'blir', 'bara', 'aldrig', 'alltid', 'hela',
  'senaste', 'live', 'se', 'las', 'lyssna', 'video', 'bild', 'bilder', 'rankar',
  'januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december',
  'mandag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lordag', 'sondag',
])

/** Fold and drop a trailing genitive/plural "s" so "Werners" and "Werner" meet. */
export function stem(word: string): string {
  const w = fold(word).replace(/[^a-z0-9]/g, '')
  return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w
}

const WORD = /[\p{L}][\p{L}\p{M}'’-]*/gu

/** Distinctive names in a piece of text: capitalised words that aren't generic. */
export function namesIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(WORD)) {
    const raw = m[0]
    for (const part of raw.split(/[-–]/)) {
      if (!/^\p{Lu}/u.test(part) || part.length < 3) continue
      // ALL-CAPS columnist labels like "WAGNER:" are bylines, not subjects.
      if (part === part.toUpperCase() && part.length > 3) continue
      const s = stem(part)
      if (s.length >= 3 && !GENERIC.has(s) && !GENERIC.has(fold(part))) out.add(s)
    }
  }
  return out
}

interface Profile {
  article: SourceArticle
  time: number
  headlineTokens: Set<string>
  names: Set<string>
  tokens: Set<string>
}

const tokenize = (text: string) => [...text.matchAll(WORD)].flatMap(m => m[0].split(/[-–]/)).map(stem).filter(Boolean)

function profile(a: SourceArticle): Profile {
  return {
    article: a,
    time: Date.parse(a.publishedAt),
    headlineTokens: new Set(tokenize(a.headline)),
    names: new Set([...namesIn(a.headline), ...namesIn(a.excerpt ?? '')]),
    tokens: new Set(tokenize(`${a.headline} ${a.excerpt ?? ''} ${slugWords(a.url)}`)),
  }
}

/** Names both articles mention (a name of one appearing anywhere in the other counts). */
export function sharedNames(a: Profile, b: Profile): string[] {
  const shared = new Set<string>()
  for (const n of a.names) if (b.tokens.has(n)) shared.add(n)
  for (const n of b.names) if (a.tokens.has(n)) shared.add(n)
  return [...shared]
}

export function linked(a: Profile, b: Profile): string[] | null {
  if (a.article.sport !== b.article.sport) return null
  if (Math.abs(a.time - b.time) > WINDOW_HOURS * 3_600_000) return null
  const shared = sharedNames(a, b)
  if (shared.length < MIN_SHARED) return null
  const inBothHeadlines = shared.some(n => a.headlineTokens.has(n) && b.headlineTokens.has(n))
  return inBothHeadlines ? shared : null
}

/** For display: the shortest original capitalised spelling of a stemmed name ("Werner" over "Werners"). */
function displayName(stemmed: string, articles: SourceArticle[]): string {
  const spellings = articles
    .flatMap(a => [...`${a.headline} ${a.excerpt ?? ''}`.matchAll(WORD)].flatMap(m => m[0].split(/[-–]/)))
    .filter(part => /^\p{Lu}/u.test(part) && stem(part) === stemmed)
    .sort((x, y) => x.length - y.length)
  return spellings[0] ?? stemmed
}

/** URL identity without tracking parameters (but keeping e.g. Bollsvenskan's `?post_id=`). */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_')) u.searchParams.delete(key)
    return u.toString()
  }
  catch {
    return url
  }
}

/** "Patrik", "Werner" → "Patrik Werner" when a source writes them side by side. */
function joinFullNames(names: string[], articles: SourceArticle[]): string[] {
  const text = articles.map(a => `${a.headline} ${a.excerpt ?? ''}`).join(' ')
  const out = [...names]
  for (const first of names) {
    for (const last of names) {
      if (first === last || !text.includes(`${first} ${last}`)) continue
      const i = out.indexOf(last)
      if (i === -1 || !out.includes(first)) continue
      out[i] = `${first} ${last}`
      out.splice(out.indexOf(first), 1)
    }
  }
  return out
}

export function groupIntoStories(articles: SourceArticle[]): Story[] {
  // Same article from two feeds (e.g. both Sportbladet sections) counts once.
  const unique = [...new Map(articles.map(a => [canonicalUrl(a.url), a])).values()]
  const profiles = unique.map(profile)

  // Union–find over linked pairs.
  const parent = profiles.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const edges = new Map<number, Set<string>>()
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const shared = linked(profiles[i]!, profiles[j]!)
      if (!shared) continue
      parent[find(i)] = find(j)
      for (const k of [i, j]) edges.set(k, new Set([...(edges.get(k) ?? []), ...shared]))
    }
  }

  const clusters = new Map<number, number[]>()
  profiles.forEach((_, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), i]))

  const stories: Story[] = [...clusters.values()].map((members) => {
    const sources = members.map(i => profiles[i]!.article).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    const lead = sources[0]!
    // The names that linked the sources — the honest "why" behind the grouping, most-mentioned first.
    const linkNames = members.length > 1 ? [...new Set(members.flatMap(i => [...(edges.get(i) ?? [])]))] : []
    const mentions = (n: string) => members.filter(i => profiles[i]!.tokens.has(n)).length
    linkNames.sort((x, y) => mentions(y) - mentions(x))
    return {
      id: `story-${lead.id}`,
      sport: lead.sport,
      sources,
      leadId: lead.id,
      sharedNames: joinFullNames(linkNames.map(n => displayName(n, sources)), sources),
      updatedAt: sources[sources.length - 1]!.publishedAt,
    }
  })

  return stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
