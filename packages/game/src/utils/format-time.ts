/**
 * Format a millisecond duration as a zero-padded `MM:SS` string.
 *
 * Used by the in-game countdown (`GamePage`) and the result page total-time
 * display (`ResultPage`). Negative inputs are clamped to `00:00` so the
 * countdown never renders a negative remainder if it briefly overshoots zero
 * before `TIME_EXPIRED` resolves.
 */
export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
