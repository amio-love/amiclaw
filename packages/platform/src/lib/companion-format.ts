import { productDayDelta, toChineseDateString } from '@shared/date'

/**
 * Render an episode's `occurred_at` (an ISO 8601 datetime) as the Chinese date
 * `YYYY 年 M 月 D 日`. Falls back to the raw string if it is not parseable, so
 * a malformed timestamp never blanks the card.
 */
export function formatOccurredAt(occurredAt: string): string {
  const datePart = occurredAt.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return occurredAt
  return toChineseDateString(datePart)
}

const GAME_LABELS: Record<string, string> = {
  bombsquad: 'BombSquad',
}

/** Display label for a `game_id`; falls back to the raw id for unknown games. */
export function gameLabel(gameId: string): string {
  return GAME_LABELS[gameId] ?? gameId
}

/**
 * Product-day age of a companion: how many CALENDAR product days (UTC dates,
 * rolling over at 08:00 Beijing) separate its `created_at` (ISO 8601) from
 * today, never negative. Derived from the product-day difference — NOT elapsed
 * 24h periods — so a companion met late at night is "1 天在一起" the next
 * morning rather than lagging a full calendar day (认识第 N 天 == this + 1).
 * Real data: `created_at` is returned by `GET /api/companion`, so this renders
 * in production too. Returns 0 for an unparseable or future-dated timestamp
 * (the card shows the "今天认识" copy for 0).
 */
export function daysTogether(createdAt: string): number {
  const delta = productDayDelta(createdAt)
  if (Number.isNaN(delta)) return 0
  return Math.max(0, delta)
}
