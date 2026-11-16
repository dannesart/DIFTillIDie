import { createClient } from '@supabase/supabase-js'

/*
 * A small in-memory PostgREST for tests: the real supabase-js client sends
 * its real requests, and the filters they carry (eq, lt, gt, is.null, in,
 * nested or/and, order, limit) are applied to plain rows. Enough to test the
 * exact queries the app builds, not a database: policies are whatever the
 * `tables` functions return (e.g. only your own rows).
 */

export type Row = Record<string, unknown>

/** Byte order, as Postgres compares these timestamps and uuids (never locale order). */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function split(s: string): string[] {
  const out: string[] = []
  let depth = 0, quoted = false, cur = ''
  for (const ch of s) {
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === '(') depth++
    if (!quoted && ch === ')') depth--
    if (!quoted && depth === 0 && ch === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}
const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)

export function matches(row: Row, expr: string): boolean {
  const logic = /^(and|or)\((.*)\)$/.exec(expr)
  if (logic) {
    const parts = split(logic[2]!).map(p => matches(row, p))
    return logic[1] === 'and' ? parts.every(Boolean) : parts.some(Boolean)
  }
  const [col, op, ...rest] = expr.split('.')
  const value = unquote(rest.join('.'))
  const v = (row[col!] ?? null) as string | null
  switch (op) {
    case 'eq': return v !== null && String(v) === value
    case 'lt': return v !== null && cmp(String(v), value) < 0
    case 'gt': return v !== null && cmp(String(v), value) > 0
    case 'is': return value === 'null' ? v === null : false
    case 'in': return split(value.replace(/^\(|\)$/g, '')).map(unquote).includes(v as string)
    default: throw new Error(`unsupported operator ${op} in ${expr}`)
  }
}

export interface FakeRequest { table: string, params: [string, string][] }

/**
 * `insert`: a POST (insert … returning) — returns the stored row (as the
 * select would show it), or throws/returns null for nothing stored.
 */
export function fakePostgrest(tables: Record<string, () => Row[]>, opts: { fail?: (table: string, req: FakeRequest) => unknown, insert?: (table: string, values: Row) => Row | null } = {}) {
  const requests: FakeRequest[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const table = url.pathname.replace('/rest/v1/', '')
    const req = { table, params: [...url.searchParams.entries()] }
    requests.push(req)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const failure = opts.fail?.(table, req)
    if (failure) return json(failure, 400)
    const accept = new Headers(init?.headers).get('accept') ?? ''
    if ((init?.method ?? 'GET') === 'POST') {
      const row = opts.insert?.(table, JSON.parse(String(init?.body)) as Row)
      if (!row) return json({ code: '42501', message: 'not allowed' }, 403)
      return json(accept.includes('vnd.pgrst.object') ? row : [row], 201)
    }
    const source = tables[table]
    if (!source) throw new Error(`unexpected read of ${table}`)
    let rows = source()
    for (const [key, value] of req.params) {
      if (['select', 'order', 'limit'].includes(key)) continue
      rows = rows.filter(r => matches(r, key === 'or' || key === 'and' ? `${key}${value}` : `${key}.${value}`))
    }
    const order = url.searchParams.get('order')
    if (order) {
      const keys = order.split(',').map(o => o.split('.') as [string, string])
      rows = [...rows].sort((a, b) => {
        for (const [col, dir] of keys) {
          const c = cmp(String(a[col]), String(b[col]))
          if (c) return dir === 'desc' ? -c : c
        }
        return 0
      })
    }
    rows = rows.slice(0, Number(url.searchParams.get('limit') ?? Infinity))
    if (accept.includes('vnd.pgrst.object')) return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', message: 'not one row' }, 406)
    return json(rows)
  }
  const client = createClient('https://fake.supabase.co', 'publishable-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } })
  return { client, requests }
}
