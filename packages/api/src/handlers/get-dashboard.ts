/**
 * GET /api/dashboard?token=xxx
 *
 * Internal-beta data dashboard. Reads existing `events:{date}:*` keys from
 * the LEADERBOARD KV namespace (written by post-event.ts), aggregates per-day
 * metrics, and renders a single static HTML page for direct browser view.
 *
 * Auth: query-string token compared against the `DASHBOARD_TOKEN` Pages secret
 * with a constant-time-ish comparison. No bypass when the env var is unset.
 *
 * Scope: temporary internal-beta tooling (5/18 → 5/31). Consider removing the
 * endpoint after the window closes. Source task: add-beta-data-dashboard.
 */

// Internal-beta north-star thresholds (mirror amiclaw roadmap §Strategic Objectives).
const THRESHOLD_COMPLETION = 70 // % — game_complete / game_start
const THRESHOLD_REPLAY = 50 // % — replay_intent / game_complete

// Hard cap on KV keys scanned per request — well above the expected
// 30 days × ~8 key kinds = ~240 keys, but guards against runaway listing.
const KV_KEY_SCAN_CAP = 5000

type CounterEvent =
  | 'game_start'
  | 'game_complete'
  | 'game_abandon'
  | 'module_solve'
  | 'manual_load_failed'
  | 'replay_intent'
  | 'game_failed_strikeout'
  | 'game_ended_timeout'

interface DailyMetrics {
  date: string
  game_start: number
  game_complete: number
  game_abandon: number
  module_solve: number
  manual_load_failed: number
  replay_intent: number
  game_failed_strikeout: number
  // Neutral cap-out counter (not a failure): a run that hit the 1-hour hard
  // cap without defusing. Renamed from game_failed_timeout when timeout stopped
  // being a fail path. Never folded into the completion-rate math.
  game_ended_timeout: number
  unique_starts: number
  unique_completes: number
}

// One endgame-survey response, read back from an `events:{date}:survey:{device_id}`
// KV key. Field values are extracted defensively (see `toSurveyRow`) — the
// survey payload is user-supplied and only structurally validated at ingestion.
interface SurveyRow {
  date: string
  device_id: string
  ai_tool: string
  fun: number | null
  difficulty: string
  ai_issue: string
}

export async function handleGetDashboard(
  request: Request,
  kv: KVNamespace,
  expectedToken: string | undefined
): Promise<Response> {
  const url = new URL(request.url)
  const providedToken = url.searchParams.get('token')

  if (!isAuthorized(providedToken, expectedToken)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const { keys, truncated } = await listAllEventKeys(kv)

  // Aggregate by date.
  const byDate = new Map<string, DailyMetrics>()
  // Survey-response keys (`events:{date}:survey:{device_id}`) are collected
  // here and read back after the metrics loop — they are not daily counters.
  const surveyKeyRefs: { key: string; date: string; device_id: string }[] = []
  for (const key of keys) {
    const parsed = parseEventKey(key)
    if (!parsed) continue
    const { date, suffix } = parsed

    // Survey responses are not daily-metric counters; collect them separately
    // and skip before `ensureDate` so they never create empty metric rows.
    if (suffix.startsWith('survey:')) {
      surveyKeyRefs.push({ key, date, device_id: suffix.slice('survey:'.length) })
      continue
    }

    const metrics = ensureDate(byDate, date)

    if (suffix === 'unique_starts' || suffix === 'unique_completes') {
      const arr = ((await kv.get(key, 'json')) as string[] | null) ?? []
      if (suffix === 'unique_starts') metrics.unique_starts = arr.length
      else metrics.unique_completes = arr.length
    } else if (isCounterEvent(suffix)) {
      const value = (await kv.get(key, 'json')) as { count?: number } | null
      const count = typeof value?.count === 'number' ? value.count : 0
      metrics[suffix] = count
    }
    // Unknown suffixes (e.g. the `survey_submit` counter) are silently
    // skipped — defence against schema drift.
  }

  // Read each survey response back. One KV value per device per day.
  const surveyRows: SurveyRow[] = []
  for (const ref of surveyKeyRefs) {
    const raw = await kv.get(ref.key, 'json')
    if (raw === null) continue
    surveyRows.push(toSurveyRow(ref.date, ref.device_id, raw))
  }
  surveyRows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.device_id < b.device_id ? -1 : 1
  })

  const rows = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1))
  const html = renderHtml(rows, surveyRows, keys.length, truncated)
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function isAuthorized(provided: string | null, expected: string | undefined): boolean {
  if (expected === undefined || expected === '') return false
  if (provided === null) return false
  return constantTimeEqual(provided, expected)
}

// Constant-time-ish string comparison. JS strings are UTF-16 in memory and
// V8 may still introduce timing variance, but a length-first, XOR-fold
// comparison is the standard mitigation available without a native binding.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function listAllEventKeys(kv: KVNamespace): Promise<{ keys: string[]; truncated: boolean }> {
  const collected: string[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await kv.list({ prefix: 'events:', cursor })
    for (const entry of page.keys) {
      collected.push(entry.name)
      if (collected.length >= KV_KEY_SCAN_CAP) {
        return { keys: collected, truncated: !page.list_complete }
      }
    }
    if (page.list_complete) {
      return { keys: collected, truncated: false }
    }
    cursor = page.cursor
    if (!cursor) {
      // Defensive: list_complete=false with no cursor should not happen,
      // but treat as truncated rather than spinning forever.
      return { keys: collected, truncated: true }
    }
  }
}

function parseEventKey(key: string): { date: string; suffix: string } | null {
  // Shape: events:{YYYY-MM-DD}:{event_name | unique_starts | unique_completes}
  // Defensive: rejoin segments [2..] with ':' in case a future suffix ever
  // contains a colon (current schema has none).
  const segments = key.split(':')
  if (segments.length < 3) return null
  if (segments[0] !== 'events') return null
  const date = segments[1]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const suffix = segments.slice(2).join(':')
  return { date, suffix }
}

function ensureDate(map: Map<string, DailyMetrics>, date: string): DailyMetrics {
  let m = map.get(date)
  if (!m) {
    m = {
      date,
      game_start: 0,
      game_complete: 0,
      game_abandon: 0,
      module_solve: 0,
      manual_load_failed: 0,
      replay_intent: 0,
      game_failed_strikeout: 0,
      game_ended_timeout: 0,
      unique_starts: 0,
      unique_completes: 0,
    }
    map.set(date, m)
  }
  return m
}

function isCounterEvent(suffix: string): suffix is CounterEvent {
  return (
    suffix === 'game_start' ||
    suffix === 'game_complete' ||
    suffix === 'game_abandon' ||
    suffix === 'module_solve' ||
    suffix === 'manual_load_failed' ||
    suffix === 'replay_intent' ||
    suffix === 'game_failed_strikeout' ||
    suffix === 'game_ended_timeout'
  )
}

interface PercentCell {
  display: string
  marker: 'pass' | 'fail' | 'none'
}

function percent(numerator: number, denominator: number, threshold: number): PercentCell {
  if (denominator <= 0) return { display: '—', marker: 'none' }
  const pct = Math.round((numerator / denominator) * 100)
  const marker: 'pass' | 'fail' = pct >= threshold ? 'pass' : 'fail'
  return { display: `${pct}%`, marker }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function markerCell(cell: PercentCell): string {
  if (cell.marker === 'pass') {
    return `<td class="num"><span class="val">${escapeHtml(cell.display)}</span> <span class="mark pass" aria-label="meets threshold">✓</span></td>`
  }
  if (cell.marker === 'fail') {
    return `<td class="num"><span class="val">${escapeHtml(cell.display)}</span> <span class="mark fail" aria-label="below threshold">✗</span></td>`
  }
  return `<td class="num"><span class="val">${escapeHtml(cell.display)}</span></td>`
}

function renderHtml(
  rows: DailyMetrics[],
  surveyRows: SurveyRow[],
  totalKeys: number,
  truncated: boolean
): string {
  const generatedAt = new Date().toISOString()

  const styles = `
    :root { color-scheme: dark; }
    body {
      background: #0f1115;
      color: #e6e8eb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 24px 16px 48px;
      font-size: 14px;
      line-height: 1.5;
    }
    h1 { font-size: 20px; margin: 0 0 12px; color: #f5f7fa; }
    h2 { font-size: 15px; margin: 32px 0 8px; color: #f5f7fa; }
    p.meta { color: #9aa1a9; margin: 4px 0; }
    .table-wrap { overflow-x: auto; margin-top: 16px; border-radius: 8px; }
    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 760px;
      background: #161922;
      font-variant-numeric: tabular-nums;
    }
    th, td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #242833;
      white-space: nowrap;
    }
    th {
      background: #1d2130;
      color: #c4c8d0;
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    td.num { text-align: right; }
    td.date { font-weight: 600; color: #f5f7fa; }
    td.wrap { white-space: normal; min-width: 220px; max-width: 380px; }
    .mark { font-weight: 700; margin-left: 4px; }
    .mark.pass { color: #5cd672; }
    .mark.fail { color: #ff6b6b; }
    .val { color: #e6e8eb; }
    .warning {
      color: #ffcc66;
      background: #2a2516;
      padding: 8px 12px;
      border-radius: 6px;
      margin: 8px 0 16px;
    }
    .empty {
      color: #9aa1a9;
      font-style: italic;
      padding: 24px;
      text-align: center;
    }
    tr.totals td {
      background: #1d2130;
      font-weight: 600;
      border-top: 2px solid #5cd672;
    }
    footer { color: #6a7079; margin-top: 24px; font-size: 12px; }
  `

  const warning = truncated
    ? `<p class="warning">Warning: KV scan cap (${KV_KEY_SCAN_CAP}) reached — table shows partial data.</p>`
    : ''

  const body =
    rows.length === 0
      ? `<p class="empty">No data yet — no \`events:*\` keys found in KV.</p>`
      : renderTable(rows)

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BombSquad Beta Stats</title>
<style>${styles}</style>
</head>
<body>
<h1>BombSquad Beta Data Dashboard</h1>
<p class="meta">north star thresholds: 单局完成率 ≥${THRESHOLD_COMPLETION}%, 复玩意愿 ≥${THRESHOLD_REPLAY}%</p>
<p class="meta">data window: KV TTL 30 days (changed from 48h on 2026-05-18); 5/12-5/15 early data already expired, not recoverable.</p>
<p class="meta">totals row sums per-day unique counts; a device active on multiple days is counted multiple times.</p>
${warning}
${body}
${renderSurveySection(surveyRows)}
<footer>generated ${escapeHtml(generatedAt)} · total keys read: ${totalKeys}</footer>
</body>
</html>`
}

function aggregateTotals(rows: DailyMetrics[]): DailyMetrics {
  // Cumulative totals across the entire visible window. For unique_starts /
  // unique_completes this sums per-day lengths — a device active on multiple
  // days is counted multiple times. Cross-date dedup would require retaining
  // the per-date arrays, which aggregateMetricsByDate intentionally drops; the
  // disclaimer in the meta footer documents this. Rates are recomputed from
  // the summed counters (not averaged), with the same 0-denom defense.
  const totals: DailyMetrics = {
    date: '合计',
    game_start: 0,
    game_complete: 0,
    game_abandon: 0,
    module_solve: 0,
    manual_load_failed: 0,
    replay_intent: 0,
    game_failed_strikeout: 0,
    game_ended_timeout: 0,
    unique_starts: 0,
    unique_completes: 0,
  }
  for (const r of rows) {
    totals.game_start += r.game_start
    totals.game_complete += r.game_complete
    totals.game_abandon += r.game_abandon
    totals.module_solve += r.module_solve
    totals.manual_load_failed += r.manual_load_failed
    totals.replay_intent += r.replay_intent
    totals.game_failed_strikeout += r.game_failed_strikeout
    totals.game_ended_timeout += r.game_ended_timeout
    totals.unique_starts += r.unique_starts
    totals.unique_completes += r.unique_completes
  }
  return totals
}

function renderRow(r: DailyMetrics, isTotals: boolean): string {
  const sessionRate = percent(r.game_complete, r.game_start, THRESHOLD_COMPLETION)
  const uniqueRate = percent(r.unique_completes, r.unique_starts, THRESHOLD_COMPLETION)
  const replayRate = percent(r.replay_intent, r.game_complete, THRESHOLD_REPLAY)
  const trOpen = isTotals ? '<tr class="totals">' : '<tr>'
  return `${trOpen}
<td class="date">${escapeHtml(r.date)}</td>
<td class="num">${r.game_start}</td>
<td class="num">${r.game_complete}</td>
${markerCell(sessionRate)}
<td class="num">${r.replay_intent}</td>
${markerCell(replayRate)}
<td class="num">${r.unique_starts}</td>
<td class="num">${r.unique_completes}</td>
${markerCell(uniqueRate)}
<td class="num">${r.module_solve}</td>
<td class="num">${r.game_abandon}</td>
<td class="num">${r.manual_load_failed}</td>
<td class="num">${r.game_failed_strikeout}</td>
<td class="num">${r.game_ended_timeout}</td>
</tr>`
}

function renderTable(rows: DailyMetrics[]): string {
  const headers = [
    'Date',
    'game_start',
    'game_complete',
    '完成率 (session)',
    'replay_intent',
    '复玩比例',
    'unique_starts',
    'unique_completes',
    '完成率 (unique)',
    'module_solve',
    'game_abandon',
    'manual_load_failed',
    'game_failed_strikeout',
    'game_ended_timeout',
  ]
  const headerRow = headers
    .map((h, i) => `<th${i === 0 ? '' : ' class="num"'}>${escapeHtml(h)}</th>`)
    .join('')

  const bodyRows = rows.map((r) => renderRow(r, false)).join('\n')
  const totalsRow = renderRow(aggregateTotals(rows), true)

  return `<div class="table-wrap"><table>
<thead><tr>${headerRow}</tr></thead>
<tbody>
${bodyRows}
${totalsRow}
</tbody>
</table></div>`
}

function toSurveyRow(date: string, device_id: string, raw: unknown): SurveyRow {
  // The survey payload is user-supplied and only structurally validated at
  // ingestion (non-empty object). Each field is type-checked here so a
  // malformed answer degrades to a blank cell rather than throwing.
  const data =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  return {
    date,
    device_id,
    ai_tool: typeof data.ai_tool === 'string' ? data.ai_tool : '',
    fun: typeof data.fun === 'number' ? data.fun : null,
    difficulty: typeof data.difficulty === 'string' ? data.difficulty : '',
    ai_issue: typeof data.ai_issue === 'string' ? data.ai_issue : '',
  }
}

function renderSurveyRow(r: SurveyRow): string {
  // Every string field is escaped — `ai_tool` / `difficulty` / `ai_issue` are
  // free-text answers and must not be able to inject markup into the page.
  const fun = r.fun === null ? '—' : String(r.fun)
  return `<tr>
<td class="date">${escapeHtml(r.date)}</td>
<td>${escapeHtml(r.device_id)}</td>
<td>${escapeHtml(r.ai_tool || '—')}</td>
<td>${escapeHtml(fun)}</td>
<td>${escapeHtml(r.difficulty || '—')}</td>
<td class="wrap">${escapeHtml(r.ai_issue || '—')}</td>
</tr>`
}

function renderSurveySection(rows: SurveyRow[]): string {
  const heading = `<h2>Survey Responses (${rows.length})</h2>`
  if (rows.length === 0) {
    return `${heading}
<p class="empty">No survey responses yet — no \`events:*:survey:*\` keys found in KV.</p>`
  }
  const headers = ['Date', 'Device', 'AI Tool', 'Fun (1-5)', 'Difficulty', 'AI Issue']
  const headerRow = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyRows = rows.map(renderSurveyRow).join('\n')
  return `${heading}
<div class="table-wrap"><table>
<thead><tr>${headerRow}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table></div>`
}
