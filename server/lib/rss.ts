import { XMLParser } from 'fast-xml-parser'

/** One <item>, reduced to the fields we use. All strings are plain text. */
export interface RssItem {
  title: string
  link: string
  guid?: string
  description?: string
  pubDate?: string
  /** Bollsvenskan-specific: comma-separated team names. */
  teams?: string[]
  enclosure?: { url: string, type?: string }
  duration?: string
}

export interface RssChannel {
  title?: string
  link?: string
  author?: string
  copyright?: string
  items: RssItem[]
}

export class FeedError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: name => name === 'item',
})

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', aring: 'å', auml: 'ä', ouml: 'ö', Aring: 'Å', Auml: 'Ä', Ouml: 'Ö', eacute: 'é',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return NAMED[e] ?? m
  })
}

/** HTML → plain text, keeping paragraph breaks as newlines. */
export function toPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

function text(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object' && '#text' in (v as object)) return text((v as { '#text': unknown })['#text'])
  return undefined
}

export function parseRss(xml: string): RssChannel {
  if (!/<rss[\s>]/i.test(xml)) throw new FeedError('Svaret är inte ett RSS-flöde')
  let doc: any
  try {
    doc = parser.parse(xml)
  }
  catch (e) {
    throw new FeedError(`Kunde inte tolka XML: ${(e as Error).message}`)
  }
  const channel = doc?.rss?.channel
  if (!channel) throw new FeedError('RSS-flödet saknar <channel>')

  const items: RssItem[] = (channel.item ?? []).map((it: any): RssItem => {
    const enclosureUrl = it.enclosure?.['@_url']
    const teams = text(it.teams)
    return {
      title: toPlainText(text(it.title) ?? ''),
      link: (text(it.link) ?? '').trim(),
      guid: text(it.guid)?.trim(),
      description: text(it.description) ? toPlainText(text(it.description)!) : undefined,
      pubDate: text(it.pubDate)?.trim(),
      teams: teams ? teams.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      enclosure: enclosureUrl ? { url: decodeEntities(enclosureUrl), type: it.enclosure['@_type'] } : undefined,
      duration: text(it['itunes:duration'])?.trim(),
    }
  }).filter((i: RssItem) => i.title && i.link)

  return {
    title: text(channel.title) && toPlainText(text(channel.title)!),
    link: text(channel.link)?.trim(),
    author: text(channel['itunes:author']) && toPlainText(text(channel['itunes:author'])!),
    copyright: text(channel.copyright) && toPlainText(text(channel.copyright)!),
    items,
  }
}

/**
 * Fetch a feed with a hard timeout. Throws FeedError with a short,
 * human-readable reason on any failure.
 */
export async function fetchFeed(url: string, opts: { timeoutMs?: number, fetcher?: typeof fetch } = {}): Promise<RssChannel> {
  const { timeoutMs = 8000, fetcher = fetch } = opts
  let res: Response
  try {
    res = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.5',
        'user-agent': 'DjurgarnTillsJagDor/0.2 (+https://github.com/dannesart/DIFTillIDie)',
      },
    })
  }
  catch (e) {
    const err = e as Error
    throw new FeedError(err.name === 'TimeoutError' || err.name === 'AbortError' ? `Tidsgräns (${timeoutMs} ms)` : `Nätverksfel: ${err.message}`)
  }
  if (!res.ok) throw new FeedError(`HTTP ${res.status}`)
  return parseRss(await res.text())
}
