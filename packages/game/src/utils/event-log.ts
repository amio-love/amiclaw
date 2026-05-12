import { getDeviceId } from './device-fingerprint'

/**
 * Frontend event logging for the BombSquad game.
 *
 * POSTs a structured `EventPayload` to the Pages Function `/api/events`,
 * which writes per-event-name counters and (for `game_start` /
 * `game_complete`) unique-device sets to the LEADERBOARD KV namespace.
 *
 * Wire shape (see `shared/event-types.ts`):
 *   { event, timestamp, device_id, data? }
 *
 * Posture is fire-and-forget: network failures are swallowed silently so
 * a flaky uplink never breaks gameplay. `keepalive: true` lets events fired
 * during page unload (e.g. `game_abandon` on tab close, `replay_intent`
 * mid-navigation) still flush after the document is torn down.
 *
 * The function signature is identical to the previous `console.info`
 * implementation so the six existing callsites do not change.
 */
export function logEvent(name: string, data: Record<string, unknown> = {}): void {
  // Fire-and-forget. Any synchronous error during payload construction
  // (e.g. `getDeviceId` failing because localStorage is unavailable in a
  // sandboxed iframe / privacy mode) and any async fetch rejection (network
  // error, CORS, abort during page unload) are intentionally swallowed:
  // telemetry must never surface to the player.
  try {
    const payload = {
      event: name,
      timestamp: new Date().toISOString(),
      device_id: getDeviceId(),
      data,
    }

    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Swallow synchronous failures (storage access denied, JSON
    // serialization throw, missing fetch in non-browser host, etc.).
  }
}
