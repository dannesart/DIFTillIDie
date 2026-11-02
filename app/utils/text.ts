export type Token =
  | { type: 'text', value: string }
  | { type: 'mention', value: string }
  | { type: 'tag', value: string }

const PATTERN = /([@#])([\p{L}\p{N}_]+)/gu

/** Splits a post body into plain text, @mentions and #tags. */
export function tokenize(body: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const match of body.matchAll(PATTERN)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ type: 'text', value: body.slice(last, index) })
    tokens.push({ type: match[1] === '@' ? 'mention' : 'tag', value: match[2]! })
    last = index + match[0].length
  }
  if (last < body.length) tokens.push({ type: 'text', value: body.slice(last) })
  return tokens
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
}
