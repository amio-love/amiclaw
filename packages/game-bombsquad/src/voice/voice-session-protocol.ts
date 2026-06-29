/**
 * Pure protocol layer for the BombSquad voice session: the server->client wire
 * envelope types, the exposed-state reducer, and the WebSocket URL builder.
 *
 * Side-effect-free (no React, no WebSocket, no Web Audio) so the turn-lifecycle
 * state machine is unit-testable by feeding it mock frames. `useVoiceSession.ts`
 * owns the side effects (socket, mic, playback) and delegates all exposed-state
 * computation to `voiceReducer` here.
 *
 * The server->client envelope shapes (`created` / `chunk` / `summary` / `error`)
 * are NOT exported from `@amiclaw/platform-ai/contract` — that subpath carries the
 * semantic contract types only (`ManualData` / `GameState` / `AiResponseChunk` /
 * `SessionSummary`), and the JSON envelope lives in the Worker-side
 * `session-do.ts`, which must never be pulled into the frontend bundle. So the
 * envelope is re-declared here, structurally matching `session-do.ts`, importing
 * only `SessionSummary` (type-only) from the contract for the `summary` frame.
 */

import type { SessionSummary } from '@amiclaw/platform-ai/contract'

/**
 * Connection lifecycle surfaced to the panel. This is the SOCKET state, distinct
 * from the in-conversation `ConversationPhase` (listening / thinking / speaking)
 * which the hands-free model layers on top of a live `ready` session.
 *  - `idle`        before the manual is ready / before connect.
 *  - `connecting`  socket opening and session being created.
 *  - `ready`       session created and live; the AI-first greeting + the
 *                  continuous hands-free conversation run while status stays
 *                  `ready` (the turn-by-turn detail lives in `ConversationPhase`).
 *  - `error`       the socket failed or closed unexpectedly (bounded `error` set).
 *  - `closed`      the session ended cleanly (a `summary` arrived / `end` acked).
 */
export type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'closed'

/**
 * In-conversation sub-state for a live (`ready`) hands-free session — the user-
 * requested 3-state indicator. Derived (purely, see `deriveConversationPhase`)
 * from live hook signals, NOT stored in the reducer:
 *  - `listening`  mic open, hearing / waiting for the player.
 *  - `thinking`   the player finished an utterance; awaiting the AI's response.
 *  - `speaking`   the AI's TTS audio is playing.
 */
export type ConversationPhase = 'listening' | 'thinking' | 'speaking'

/** Live signals the conversation phase is derived from. */
export interface PhaseSignals {
  /** TTS audio is currently scheduled / playing. */
  isAiSpeaking: boolean
  /** Client VAD reports the player is currently speaking. */
  playerSpeaking: boolean
  /** An utterance ended (or the opening greeting is pending) with no AI audio yet. */
  awaitingResponse: boolean
}

/**
 * Map the live signals to the 3-state conversation phase. Pure and total. Order
 * is a strict priority: the AI speaking wins (`speaking`); else an active player
 * utterance reads as `listening`; else a pending response reads as `thinking`;
 * otherwise the session is idly `listening` for the player.
 */
export function deriveConversationPhase(s: PhaseSignals): ConversationPhase {
  if (s.isAiSpeaking) return 'speaking'
  if (s.playerSpeaking) return 'listening'
  if (s.awaitingResponse) return 'thinking'
  return 'listening'
}

/**
 * One server->client JSON frame. Structurally mirrors the envelope
 * `session-do.ts` emits: `created` on session create, `chunk` per streamed
 * text/audio fragment (audio base64-encoded for the JSON channel), `summary` on
 * `end`, and a non-fatal in-band `error` (e.g. `turn_in_flight`,
 * `already_created`) that does NOT close the socket.
 */
export type ServerFrame =
  | { type: 'created'; sessionId: string }
  | { type: 'chunk'; kind: 'text'; text?: string; done: boolean }
  | { type: 'chunk'; kind: 'audio'; audio?: string; done: boolean }
  | { type: 'summary'; summary: SessionSummary }
  | { type: 'error'; code?: string; message?: string }

/** Reducer actions: server frames plus the local lifecycle transitions. */
export type VoiceAction =
  | { type: 'connecting' }
  | { type: 'frame'; frame: ServerFrame }
  | { type: 'barge-in' }
  | { type: 'mic-error'; message: string }
  | { type: 'transport-error'; message: string }
  | { type: 'closed' }

/** The reducer-owned slice of the hook's exposed state. */
export interface VoiceSessionState {
  status: VoiceStatus
  sessionId: string | null
  /** Accumulated AI text for the current turn (cleared when a new turn starts). */
  aiText: string
  /**
   * True once the current turn's last (`done`) chunk has been seen — so the next
   * turn's first chunk resets `aiText` instead of appending. With server-driven
   * hands-free turns there is no client turn-start signal, so the turn boundary
   * is detected from the `done` flag. Starts `true` so the first turn (the AI
   * opening greeting) renders fresh.
   */
  turnDone: boolean
  /** Last bounded error message, or null. */
  error: string | null
  /** Session summary, set once `end` is acknowledged. */
  summary: SessionSummary | null
}

export const initialVoiceState: VoiceSessionState = {
  status: 'idle',
  sessionId: null,
  aiText: '',
  turnDone: true,
  error: null,
  summary: null,
}

/** Cap an error message to a bounded length so a provider error never floods state. */
const MAX_ERROR_CHARS = 200
export function boundError(message: string): string {
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS - 1)}…` : message
}

/**
 * Compute the next exposed state from the current state and one action. Pure and
 * total — every action maps to a defined transition, and unknown/irrelevant
 * frames are no-ops. This is the single source of truth for the turn lifecycle.
 */
export function voiceReducer(state: VoiceSessionState, action: VoiceAction): VoiceSessionState {
  switch (action.type) {
    case 'connecting':
      // Fresh connect resets the per-session surface.
      return { ...initialVoiceState, status: 'connecting' }

    case 'frame':
      return reduceFrame(state, action.frame)

    case 'barge-in':
      // The player interrupted the AI mid-response. Drop the interrupted turn's
      // rendered text and mark the turn boundary closed so the AI's NEXT turn
      // (the answer to the interruption) starts fresh. The hook separately stops
      // playback and suppresses the interrupted turn's remaining chunks.
      return { ...state, aiText: '', turnDone: true }

    case 'mic-error':
      // Mic capture failure is NOT a socket failure: surface the bounded message
      // but keep the session usable (status unchanged).
      return { ...state, error: boundError(action.message) }

    case 'transport-error':
      return { ...state, status: 'error', error: boundError(action.message) }

    case 'closed':
      // A clean close after `summary` keeps `closed`; an explicit close with no
      // prior terminal state still lands `closed`.
      return state.status === 'closed' ? state : { ...state, status: 'closed' }

    default:
      return state
  }
}

function reduceFrame(state: VoiceSessionState, frame: ServerFrame): VoiceSessionState {
  switch (frame.type) {
    case 'created':
      return { ...state, status: 'ready', sessionId: frame.sessionId }

    case 'chunk': {
      // Server-driven hands-free turns give no turn-start signal, so a turn
      // boundary is detected from the prior chunk's `done`: the first chunk after
      // a `done` (or the very first chunk) starts a fresh `aiText`; later chunks
      // of the same turn append. Audio chunks are a playback side effect the hook
      // owns — only their `done` flag matters here. Status stays `ready` for the
      // whole live session; the conversation phase carries the turn-level detail.
      const base = state.turnDone ? '' : state.aiText
      const aiText = frame.kind === 'text' ? base + (frame.text ?? '') : base
      return { ...state, aiText, turnDone: frame.done }
    }

    case 'summary':
      return { ...state, status: 'closed', summary: frame.summary }

    case 'error':
      // In-band, non-fatal server error; it does NOT close the socket. The benign
      // rejections the hands-free client provokes on its own — `turn_in_flight`
      // (the VAD raced the server's in-flight turn) and `already_created` (a
      // duplicate create) — are no-ops the player should never see, so they leave
      // state untouched. Any other in-band error still surfaces a bounded message.
      if (frame.code === 'turn_in_flight' || frame.code === 'already_created') return state
      return { ...state, error: boundError(frame.message ?? frame.code ?? 'session error') }

    default:
      return state
  }
}

/** Minimal view of `window.location` the URL builder needs. */
export interface LocationLike {
  protocol: string
  host: string
}

/**
 * Build the same-origin voice WebSocket URL: `wss://` on https, `ws://` on http,
 * host from `location.host`, path `/ai-ws/<sessionName>`. The session cookie
 * rides along same-origin, so the hook sends no userId — auth is the Worker's
 * handshake concern. Mirrors the demo's connect URL construction.
 */
export function buildSessionUrl(location: LocationLike, sessionName: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ai-ws/${sessionName}`
}

/** Generate a random, collision-unlikely session name for the WS path. */
export function randomSessionName(): string {
  return `bombsquad-${Math.random().toString(36).slice(2, 10)}`
}
