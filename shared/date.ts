/* The product day is the UTC date: every daily surface (daily challenge,
   leaderboard, checklist, Oracle sign) keys "today" off this string, and all
   of them roll over together at UTC midnight (08:00 Beijing time). */
export function getTodayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10) // YYYY-MM-DD (UTC product day)
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
