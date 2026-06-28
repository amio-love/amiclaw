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
 * Connection / turn status surfaced to the panel.
 *  - `idle`        before the manual is ready / before connect.
 *  - `connecting`  socket opening and session being created.
 *  - `ready`       session created; the player may push-to-talk.
 *  - `in-turn`     a turn is in progress (player speaking or AI responding).
 *  - `error`       the socket failed or closed unexpectedly (bounded `error` set).
 *  - `closed`      the session ended cleanly (a `summary` arrived / `end` acked).
 */
export type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'in-turn' | 'error' | 'closed'

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
  | { type: 'talk-start' }
  | { type: 'frame'; frame: ServerFrame }
  | { type: 'mic-error'; message: string }
  | { type: 'transport-error'; message: string }
  | { type: 'closed' }

/** The reducer-owned slice of the hook's exposed state. */
export interface VoiceSessionState {
  status: VoiceStatus
  sessionId: string | null
  /** Accumulated AI text for the current turn (cleared when a new turn starts). */
  aiText: string
  /** Last bounded error message, or null. */
  error: string | null
  /** Session summary, set once `end` is acknowledged. */
  summary: SessionSummary | null
}

export const initialVoiceState: VoiceSessionState = {
  status: 'idle',
  sessionId: null,
  aiText: '',
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

    case 'talk-start':
      // A new turn begins only from `ready`; clear the prior turn's text + error
      // so the panel shows this turn's reply fresh.
      if (state.status !== 'ready') return state
      return { ...state, status: 'in-turn', aiText: '', error: null }

    case 'frame':
      return reduceFrame(state, action.frame)

    case 'mic-error':
      // Mic capture failure is NOT a socket failure: surface the bounded message
      // but keep the session usable (status unchanged — capture never reached
      // `in-turn`, which is set only after the mic is acquired).
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
      // Text chunks accumulate into `aiText`; audio chunks are a playback side
      // effect the hook handles, so only their `done` flag matters here. ANY
      // chunk flagged `done` is the turn's last fragment -> back to `ready`.
      const aiText = frame.kind === 'text' ? state.aiText + (frame.text ?? '') : state.aiText
      const status: VoiceStatus = frame.done
        ? 'ready'
        : state.status === 'ready'
          ? 'in-turn'
          : state.status
      return { ...state, aiText, status }
    }

    case 'summary':
      return { ...state, status: 'closed', summary: frame.summary }

    case 'error':
      // In-band, non-fatal server error (e.g. `turn_in_flight`). Surface the
      // bounded message; leave status to the streaming/lifecycle handlers (the
      // rejected message did not close the socket).
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
