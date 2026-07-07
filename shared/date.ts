/* The product day is the UTC date: every daily surface (daily challenge,
   leaderboard, checklist, Oracle sign) keys "today" off this string, and all
   of them roll over together at UTC midnight (08:00 Beijing time). */
export function getTodayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10) // YYYY-MM-DD (UTC product day)
}

/* The `count` product days ending at the `today` product day (inclusive),
   newest first. The SINGLE derivation source for every recent-history day
   window — the /me history summary, the leaderboard date switcher — so the
   surfaces cannot drift apart on day boundaries. */
export function getProductDaysEndingAt(today: string, count: number): string[] {
  const [year, month, day] = today.split('-').map(Number)
  const anchor = Date.UTC(year, month - 1, day)
  return Array.from({ length: count }, (_, offset) =>
    new Date(anchor - offset * 86_400_000).toISOString().slice(0, 10)
  )
}

/* The most recent `count` product days, today first, anchored on the same UTC
   product-day source as getTodayString. */
export function getRecentProductDays(count: number, now: Date = new Date()): string[] {
  return getProductDaysEndingAt(getTodayString(now), count)
}

/* Render a `YYYY-MM-DD` string as the Chinese date form
   `YYYY 年 M 月 D 日`, stripping leading zeros from month and day.
   Defaults to today when no argument is given. */
export function toChineseDateString(iso?: string): string {
  const [y, m, d] = (iso ?? getTodayString()).split('-')
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`
}

/* Local wall-clock time (`HH:MM`) at which the product day rolls over —
   the next UTC midnight rendered in the viewer's timezone (or an explicit
   `timeZone`, used by tests). Handles non-hour offsets (e.g. UTC+05:45). */
export function getLocalRolloverTime(now: Date = new Date(), timeZone?: string): string {
  const nextRollover = new Date(now)
  nextRollover.setUTCHours(24, 0, 0, 0)
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(nextRollover)
}

/* Compact user-facing hint stating the daily-reset rule. Shown wherever
   今日/每日 content or the reset countdown appears, so players returning
   before the local rollover time understand why "today" hasn't changed. */
export function getDailyResetHint(now: Date = new Date(), timeZone?: string): string {
  return `每日内容按 UTC 日期刷新 · 本地时间每天 ${getLocalRolloverTime(now, timeZone)}`
}
