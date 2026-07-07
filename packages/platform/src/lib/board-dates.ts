import { getRecentProductDays } from '@shared/date'

/* Date-switcher model for the recent-history surfaces (daily leaderboard
   navigation, the /me 7-day record view). Both derive their day set from the
   same UTC product-day source as getTodayString, so "昨天" here is exactly the
   board/checklist day that just rolled over.

   Window sizes are the CALLER's contract: the leaderboard switcher walks
   exactly LEADERBOARD_RETENTION_DAYS (@shared/leaderboard-types — the KV
   retention the daily boards actually have), while the /me history walks the
   arcade-profile HISTORY_WINDOW_DAYS (durable D1 / localStorage records). */

export interface BoardDay {
  /** Product day, `YYYY-MM-DD`. */
  date: string
  /** Compact user-facing label: 今天 / 昨天 / 前天 / M 月 D 日. */
  label: string
}

/* Label a product day by its offset from today. The short windows make the
   year redundant, so day 3+ uses the short `M 月 D 日` form. */
export function boardDayLabel(date: string, offset: number): string {
  if (offset === 0) return '今天'
  if (offset === 1) return '昨天'
  if (offset === 2) return '前天'
  const [, month, day] = date.split('-')
  return `${Number(month)} 月 ${Number(day)} 日`
}

/** The last `count` product days (today first) with their switcher labels. */
export function getBoardDays(count: number, now: Date = new Date()): BoardDay[] {
  return getRecentProductDays(count, now).map((date, offset) => ({
    date,
    label: boardDayLabel(date, offset),
  }))
}
