import { toChineseDateString } from '@shared/date'

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
