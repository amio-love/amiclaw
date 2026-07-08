/**
 * Render a real ISO timestamp as a Chinese relative-time string, computed LIVE
 * against `now`.
 *
 * This is the fix for the community-feed anti-pattern (audit F4): the old fake
 * posts hardcoded a frozen 「12 分钟前」 that never advanced. A relative label is
 * only honest when it is derived from the real event time at render, so this
 * helper takes the event ISO and the current time and returns the correct label
 * every time it runs — 刚刚 / N 分钟前 / N 小时前 / N 天前, and an absolute
 * `M 月 D 日` once the event is a week or more old (relative wording past a week
 * carries no useful precision).
 *
 * A future `at` (clock skew across devices) clamps to 刚刚 rather than showing a
 * nonsensical negative age.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''

  const diffMs = now.getTime() - then
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`

  const date = new Date(then)
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`
}
