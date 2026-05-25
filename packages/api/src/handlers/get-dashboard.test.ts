import { describe, expect, it } from 'vitest'
import { handleGetDashboard } from './get-dashboard'

// Minimal in-memory KV mock. Implements just the surface handleGetDashboard
// touches: `list({ prefix, cursor })` and `get(key, 'json')`. We page the
// list result in chunks to exercise the pagination loop in real tests.
interface ListOptions {
  prefix?: string
  cursor?: string
  limit?: number
}

interface ListResult<TMeta = unknown> {
  keys: { name: string; expiration?: number; metadata?: TMeta }[]
  list_complete: boolean
  cursor?: string
}

function makeKv(store: Record<string, unknown>, pageSize = 1000): KVNamespace {
  const allKeys = Object.keys(store)

  const list = async (options: ListOptions = {}): Promise<ListResult> => {
    const prefix = options.prefix ?? ''
    const filtered = allKeys.filter((k) => k.startsWith(prefix)).sort()
    const startCursor = options.cursor ? Number(options.cursor) : 0
    const slice = filtered.slice(startCursor, startCursor + pageSize)
    const nextStart = startCursor + slice.length
    const complete = nextStart >= filtered.length
    return {
      keys: slice.map((name) => ({ name })),
      list_complete: complete,
      cursor: complete ? undefined : String(nextStart),
    }
  }

  const get = async (key: string, type?: string): Promise<unknown> => {
    if (!(key in store)) return null
    const raw = store[key]
    if (type === 'json') return raw
    return raw
  }

  // Cast the partial mock through `unknown` to satisfy the workers-types
  // `KVNamespace` shape — we only use `list` and `get`.
  return { list, get } as unknown as KVNamespace
}

function makeRequest(query = ''): Request {
  return new Request(`https://bombsquad.amio.fans/api/dashboard${query}`, { method: 'GET' })
}

describe('handleGetDashboard', () => {
  it('returns 200 HTML with the expected rows for a valid token + populated KV', async () => {
    const store = {
      'events:2026-05-18:game_start': { count: 10 },
      'events:2026-05-18:game_complete': { count: 7 },
      'events:2026-05-18:replay_intent': { count: 5 },
      'events:2026-05-18:unique_starts': ['d1', 'd2', 'd3'],
      'events:2026-05-18:unique_completes': ['d1', 'd2'],
      'events:2026-05-17:game_start': { count: 4 },
      'events:2026-05-17:game_complete': { count: 2 },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=secret-abc'), kv, 'secret-abc')

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const html = await res.text()
    // 2026-05-18 row: 10 starts, 7 completes, 70% session, 71% replay, 3/2 unique
    expect(html).toContain('2026-05-18')
    expect(html).toContain('>10<')
    expect(html).toContain('>7<')
    expect(html).toContain('>5<')
    // session-level 完成率 = 70% (7/10) — ≥70% threshold ⇒ ✓
    expect(html).toMatch(/70%[\s\S]*?✓/)
    // 复玩比例 = 71% (5/7) — ≥50% threshold ⇒ ✓
    expect(html).toMatch(/71%[\s\S]*?✓/)
    // 2026-05-17 row: session 50% — below 70% threshold ⇒ ✗
    expect(html).toContain('2026-05-17')
    expect(html).toMatch(/50%[\s\S]*?✗/)
    // Most-recent date appears before the older date in the rendered output.
    expect(html.indexOf('2026-05-18')).toBeLessThan(html.indexOf('2026-05-17'))
    // Footer reports total keys read.
    expect(html).toContain('total keys read:')
  })

  it('returns 401 plain text when the token is wrong', async () => {
    const kv = makeKv({})
    const res = await handleGetDashboard(makeRequest('?token=wrong'), kv, 'secret-abc')
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
  })

  it('returns 401 when the token query parameter is missing', async () => {
    const kv = makeKv({})
    const res = await handleGetDashboard(makeRequest(''), kv, 'secret-abc')
    expect(res.status).toBe(401)
  })

  it('returns 401 when DASHBOARD_TOKEN env var is unset (no bypass)', async () => {
    const kv = makeKv({})
    const res = await handleGetDashboard(makeRequest('?token=anything'), kv, undefined)
    expect(res.status).toBe(401)
  })

  it('returns 401 when DASHBOARD_TOKEN env var is the empty string', async () => {
    const kv = makeKv({})
    const res = await handleGetDashboard(makeRequest('?token='), kv, '')
    expect(res.status).toBe(401)
  })

  it('returns 200 with an empty-state message when no events keys are present', async () => {
    const kv = makeKv({})
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('No data yet')
    expect(html).toContain('total keys read: 0')
  })

  it('renders 完成率 as — (em dash) when game_start denominator is 0', async () => {
    const store = {
      'events:2026-05-18:game_start': { count: 0 },
      'events:2026-05-18:game_complete': { count: 0 },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('—')
    expect(html).not.toMatch(/NaN/)
    expect(html).not.toMatch(/Infinity/)
    // The three percentage cells (session / replay / unique) for this row
    // must all render as em dash — no numeric percentage should appear
    // anywhere inside a <td class="num"><span class="val">…</span> shell.
    const tdPercentMatches = html.match(/<td class="num"><span class="val">[^<]+<\/span>/g) ?? []
    for (const cell of tdPercentMatches) {
      expect(cell, `unexpected non-dash percent cell: ${cell}`).toContain('—')
    }
  })

  it('renders 复玩比例 as — when game_complete denominator is 0', async () => {
    const store = {
      'events:2026-05-18:game_start': { count: 5 },
      'events:2026-05-18:game_complete': { count: 0 },
      'events:2026-05-18:replay_intent': { count: 0 },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('—')
  })

  it('renders 完成率 (unique) as — when unique_starts is empty', async () => {
    const store = {
      'events:2026-05-18:game_start': { count: 3 },
      'events:2026-05-18:game_complete': { count: 1 },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()
    // session rate is 33% (1/3) — present
    expect(html).toContain('33%')
    // unique rate denom is 0 → em dash
    expect(html).toContain('—')
  })

  it('paginates through multiple KV list pages', async () => {
    const store: Record<string, unknown> = {}
    // 15 days × 2 counters = 30 keys; force pageSize=10 so we span 3 pages.
    for (let day = 1; day <= 15; day++) {
      const date = `2026-05-${String(day).padStart(2, '0')}`
      store[`events:${date}:game_start`] = { count: day }
      store[`events:${date}:game_complete`] = { count: Math.floor(day / 2) }
    }
    const kv = makeKv(store, 10)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()
    // All 15 days must appear in the table.
    for (let day = 1; day <= 15; day++) {
      const date = `2026-05-${String(day).padStart(2, '0')}`
      expect(html, `missing date ${date}`).toContain(date)
    }
    expect(html).toContain('total keys read: 30')
  })

  it('renders a cumulative totals row that aggregates across all visible dates', async () => {
    // Seed two dates so the totals row demonstrates true counter-sum rate
    // (NOT an average of per-day rates).
    //   day 18: 10 starts, 4 completes  → session 40%
    //   day 17:  4 starts, 2 completes  → session 50%
    //   totals: (4+2)/(10+4) = 6/14    → 43%  (NOT (40+50)/2 = 45%)
    // 43% is unambiguously below the 70% threshold, so the totals row must
    // render the ✗ marker. replay sums to 3 over 6 completes = 50% → ≥50% ✓.
    const store = {
      'events:2026-05-18:game_start': { count: 10 },
      'events:2026-05-18:game_complete': { count: 4 },
      'events:2026-05-18:replay_intent': { count: 2 },
      'events:2026-05-18:unique_starts': ['d1', 'd2', 'd3'],
      'events:2026-05-18:unique_completes': ['d1'],
      'events:2026-05-17:game_start': { count: 4 },
      'events:2026-05-17:game_complete': { count: 2 },
      'events:2026-05-17:replay_intent': { count: 1 },
      'events:2026-05-17:unique_starts': ['d4', 'd5'],
      'events:2026-05-17:unique_completes': ['d4'],
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()

    // Exactly one totals row, marked by `tr.totals` and the literal `合计`
    // in the date cell.
    const totalsRowMatches = html.match(/<tr class="totals">[\s\S]*?<\/tr>/g) ?? []
    expect(totalsRowMatches).toHaveLength(1)
    const totalsRow = totalsRowMatches[0]
    expect(totalsRow).toContain('合计')

    // Summed counters: game_start = 14, game_complete = 6, replay_intent = 3,
    // unique_starts = 5, unique_completes = 2.
    expect(totalsRow).toContain('>14<')
    expect(totalsRow).toContain('>6<')
    expect(totalsRow).toContain('>3<')
    expect(totalsRow).toContain('>5<')
    expect(totalsRow).toContain('>2<')

    // session rate from summed counters: 6/14 = 43% — below threshold ⇒ ✗.
    // Must NOT be the per-day-average (45%) — that would prove averaging.
    expect(totalsRow).toMatch(/43%[\s\S]*?✗/)
    expect(totalsRow).not.toContain('45%')

    // replay rate from summed counters: 3/6 = 50% — meets threshold ⇒ ✓.
    expect(totalsRow).toMatch(/50%[\s\S]*?✓/)

    // unique rate from summed lengths: 2/5 = 40% — below threshold ⇒ ✗.
    expect(totalsRow).toMatch(/40%[\s\S]*?✗/)

    // Disclaimer about unique double-counting must be present in the footer.
    expect(html).toContain('counted multiple times')
  })

  it('renders the totals row with — when every per-day denominator is 0', async () => {
    // Two dates, both with 0 game_start so every denominator across the
    // window is 0. The totals row must also render — (not 0%, not NaN).
    const store = {
      'events:2026-05-18:game_start': { count: 0 },
      'events:2026-05-18:game_complete': { count: 0 },
      'events:2026-05-17:game_start': { count: 0 },
      'events:2026-05-17:game_complete': { count: 0 },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()

    const totalsRowMatches = html.match(/<tr class="totals">[\s\S]*?<\/tr>/g) ?? []
    expect(totalsRowMatches).toHaveLength(1)
    const totalsRow = totalsRowMatches[0]!
    expect(totalsRow).toContain('合计')

    // No numeric percentage anywhere in the totals row — every percent cell
    // must render the em dash.
    expect(totalsRow).not.toMatch(/\d+%/)
    expect(totalsRow).not.toMatch(/NaN/)
    expect(totalsRow).not.toMatch(/Infinity/)
    const percentCells = totalsRow.match(/<td class="num"><span class="val">[^<]+<\/span>/g) ?? []
    expect(percentCells.length).toBeGreaterThan(0)
    for (const cell of percentCells) {
      expect(cell, `unexpected non-dash percent cell in totals row: ${cell}`).toContain('—')
    }
  })

  it('renders game_failed_strikeout / game_failed_timeout columns with per-day and totals values', async () => {
    const store = {
      'events:2026-05-18:game_start': { count: 10 },
      'events:2026-05-18:game_failed_strikeout': { count: 3 },
      'events:2026-05-18:game_failed_timeout': { count: 2 },
      'events:2026-05-17:game_start': { count: 6 },
      'events:2026-05-17:game_failed_strikeout': { count: 1 },
      'events:2026-05-17:game_failed_timeout': { count: 4 },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()

    // Both event names appear as their own column headers.
    expect(html).toContain('<th class="num">game_failed_strikeout</th>')
    expect(html).toContain('<th class="num">game_failed_timeout</th>')

    // The two new columns are the last two cells of every row.
    // 2026-05-18: strikeout 3, timeout 2.
    expect(html).toContain('<td class="num">3</td>\n<td class="num">2</td>\n</tr>')
    // 2026-05-17: strikeout 1, timeout 4.
    expect(html).toContain('<td class="num">1</td>\n<td class="num">4</td>\n</tr>')

    // Totals row sums both columns: strikeout 3+1=4, timeout 2+4=6.
    const totalsRow = (html.match(/<tr class="totals">[\s\S]*?<\/tr>/g) ?? [])[0]
    expect(totalsRow).toContain('<td class="num">4</td>\n<td class="num">6</td>\n</tr>')
  })

  it('uses constant-time comparison — same-length wrong token still returns 401', async () => {
    // Sanity check that the equality is not a structural shortcut: a token
    // whose length matches but content differs must still fail.
    const kv = makeKv({})
    const res = await handleGetDashboard(makeRequest('?token=AAAAAAAA'), kv, 'BBBBBBBB')
    expect(res.status).toBe(401)
  })

  it('renders a survey responses section listing each device answers', async () => {
    const store = {
      'events:2026-05-22:game_start': { count: 5 },
      // The `survey_submit` counter is a known-but-undisplayed suffix — it
      // must not break or appear in the main metrics table.
      'events:2026-05-22:survey_submit': { count: 2 },
      'events:2026-05-22:survey:aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee': {
        ai_tool: 'claude',
        fun: 5,
        difficulty: 'just-right',
        ai_issue: 'voice lag near the end',
      },
      'events:2026-05-22:survey:bbbbbbbb-cccc-4ddd-9eee-ffffffffffff': {
        ai_tool: 'chatgpt',
        fun: 3,
        difficulty: 'too-hard',
      },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()

    // The survey section heading reports the response count.
    expect(html).toContain('Survey Responses (2)')

    // Both devices' answers are rendered.
    expect(html).toContain('claude')
    expect(html).toContain('just-right')
    expect(html).toContain('voice lag near the end')
    expect(html).toContain('chatgpt')
    expect(html).toContain('too-hard')

    // The optional ai_issue is absent for the second device — renders em dash.
    expect(html).toContain('—')

    // The main metrics table is unaffected: game_start still renders 5.
    expect(html).toContain('<td class="num">5</td>')
  })

  it('shows the empty-state survey message when no survey keys exist', async () => {
    const store = {
      'events:2026-05-22:game_start': { count: 3 },
    }
    const kv = makeKv(store)
    const res = await handleGetDashboard(makeRequest('?token=t'), kv, 't')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Survey Responses (0)')
    expect(html).toContain('No survey responses yet')
  })
})
