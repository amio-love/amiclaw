/**
 * Frontend event logging for the BombSquad game.
 *
 * Emits a single structured `console.info` line per event so that during the
 * first post-ship week we can manually estimate the 单局完成率 north-star
 * metric (>= 70% completion within 10 minutes) by scanning browser console
 * logs. Backend KV ingestion is intentionally deferred — this helper exists
 * only as a stable, structured shape for later automation.
 *
 * Wire format:
 *   console.info('[bombsquad-event]', { event, timestamp, ...data })
 *
 * `timestamp` is ISO 8601 (UTC) so logs from different clients sort.
 */
export const EVENT_LOG_PREFIX = '[bombsquad-event]'

export function logEvent(name: string, data: Record<string, unknown> = {}): void {
  const payload = {
    event: name,
    timestamp: new Date().toISOString(),
    ...data,
  }
  // `console.info` is the intended channel; the project lint config allows
  // only `warn`/`error` by default, so opt out locally for this telemetry sink.
  // eslint-disable-next-line no-console
  console.info(EVENT_LOG_PREFIX, payload)
}
