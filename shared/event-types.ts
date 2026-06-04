/**
 * Wire-shared types for the `/api/events` ingestion pipeline.
 *
 * Frontend `packages/game-bombsquad/src/utils/event-log.ts` constructs an
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
  | 'game_failed_strikeout'
  | 'game_ended_timeout'
  | 'survey_submit'

export interface EventPayload {
  event: EventName
  timestamp: string // ISO 8601 UTC, emitted by the client
  device_id: string // UUID v4 from localStorage (shared with leaderboard)
  data?: Record<string, unknown>
}

/**
 * Endgame-survey answers, carried as `EventPayload.data` on a `survey_submit`
 * event. The client shows the survey once per device, so the server persists
 * exactly one `SurveyAnswers` object per device per day (KV key
 * `events:{date}:survey:{device_id}`) — no accumulation, no read-modify-write.
 *
 * Field-level caps (`ai_tool` ≤ 40 chars, `ai_issue` ≤ 200 chars) are enforced
 * client-side. The server enforces only the generic 1KB `data` byte cap and a
 * non-empty-object check (see `validateEvent`); it does not re-validate the
 * shape, so dashboard rendering treats every field defensively.
 */
export interface SurveyAnswers {
  ai_tool: string // 'claude' | 'chatgpt' | 'gemini' | free text; client caps at 40 chars
  fun: number // integer 1-5
  difficulty: 'too-hard' | 'just-right' | 'too-easy'
  ai_issue?: string // optional free text, client caps at 200 chars
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
