/**
 * Wire-shared types for the `/api/events` ingestion pipeline.
 *
 * Frontend `packages/game/src/utils/event-log.ts` constructs an
 * `EventPayload` and POSTs it to the Pages Function entry
 * `functions/api/events.ts`, which delegates to the
 * `packages/api/src/handlers/post-event.ts` handler.
 *
 * Kept intentionally separate from `leaderboard-types.ts` so the two
 * ingestion paths can evolve independently.
 */

export type EventName =
  | 'game_start'
  | 'module_solve'
  | 'game_complete'
  | 'game_abandon'
  | 'manual_load_failed'
  | 'replay_intent'

export interface EventPayload {
  event: EventName
  timestamp: string // ISO 8601 UTC, emitted by the client
  device_id: string // UUID v4 from localStorage (shared with leaderboard)
  data?: Record<string, unknown>
}

/**
 * Response envelope returned from `/api/events`.
 *
 * Single shape `{ ok: boolean; error?: string }` is chosen over a discriminated
 * union for ergonomic reasons: the client side fire-and-forgets and never
 * narrows on `ok`, and the server side never needs to construct a "success
 * with error" sentinel. Verifier / future consumers can rely on the invariant
 * that `error` is present iff `ok === false`.
 */
export interface EventIngestionResponse {
  ok: boolean
  error?: string
}
