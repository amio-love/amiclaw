/**
 * Pure protocol layer for a platform-ai voice session (game-agnostic): the
 * server->client wire envelope types, the exposed-state reducer, and the
 * WebSocket URL builder. Shared by every client consumer — the in-game
 * `useVoiceSession` and the lobby `useLobbyVoiceSession`.
 *
 * Side-effect-free (no React, no WebSocket, no Web Audio) so the turn-lifecycle
 * state machine is unit-testable by feeding it mock frames. The hooks own the
 * side effects (socket, mic, playback) and delegate all exposed-state
 * computation to `voiceReducer` here.
 *
 * The server->client envelope shapes (`created` / `chunk` / `summary` / `error`)
 * are re-declared here, structurally matching the Worker-side `session-do.ts`,
 * which must never be pulled into the frontend bundle. `shared/` is deliberately
 * free of any `@amiclaw/*` workspace dependency (it is compiled in each consuming
 * package's context, walking up from `shared/` where no package `node_modules`
 * exists), so the `summary` frame carries the summary as an OPAQUE token
 * ({@link SessionSummaryPayload}) rather than importing the server's concrete
 * `SessionSummary` type: the client only stores and forwards it, never reads its
 * fields. A consumer that needs the concrete type re-narrows at its own boundary
 * (it can import `@amiclaw/platform-ai/contract` from inside its package).
 *
 * Note: the per-consumer WS session-name generator is deliberately NOT here — each
 * hook mints its own (`bombsquad-…` / `lobby-…`) so a session name is
 * self-identifying on the wire; `buildSessionUrl` takes the name as an argument.
 */

/**
 * The end-of-session summary payload, opaque at the shared layer. Its concrete
 * wire shape is the server's `SessionSummary` (`@amiclaw/platform-ai/contract`);
 * the client stores and forwards it without reading any field, so `unknown`
 * keeps `shared/` dependency-free while a consumer re-narrows at its boundary.
 */
export type SessionSummaryPayload = unknown

/**
 * One co_build partner board move. A STRUCTURAL mirror of the server's
 * `@amiclaw/platform-ai` `CoBuildAction` — re-declared here (not imported) so
 * `shared/` stays free of any `@amiclaw/*` workspace dependency, exactly as the
 * server envelope shapes are. A co_build game re-narrows to the concrete type at
 * its own boundary; other games never see an `action` frame at all.
 */
export interface CoBuildAction {
  op: 'place' | 'remove'
  pieceType: string
  slot: number
}

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
 * `session-do.ts` emits: `created` on session create, `transcript` STREAMED as
 * recognition builds (repeated interim frames whose `text` is the CUMULATIVE
 * recognized utterance so far with `final: false`/absent, then one `final: true`
 * frame carrying the full utterance; the running `text` resets per utterance and
 * a no-speech turn sends none) and arriving before that turn's AI reply chunks,
 * `chunk` per streamed text/audio fragment (audio base64-encoded for the JSON
 * channel), `summary` on `end`, and a non-fatal in-band `error` (e.g.
 * `turn_in_flight`, `already_created`) that does NOT close the socket. `final` is
 * optional; a missing flag is treated as a non-terminal interim.
 *
 * The `action` frame carries a co_build partner's structured board moves (co_build
 * games only). It is its OWN frame — NOT a `chunk` — and carries no `done` (the AI
 * reply's terminal text `chunk` still closes the turn). It is handled by the hook's
 * single explicit `onAction` branch and NEVER reaches `voiceReducer`; a game without
 * an `onAction` callback ignores it (a no-op, not an unknown-frame surfacing).
 *
 * Turn termination is a TEXT event: the `text` chunk is the only variant that can
 * carry `done: true`. The `audio` chunk is pinned `done: false` (audio frames never
 * close a turn — they interleave with text and the turn ends on the terminal text
 * chunk), matching the server contract; `transcript` and `action` carry no `done`
 * at all. So the type structurally guarantees no non-text frame can end a turn.
 */
export type ServerFrame =
  | { type: 'created'; sessionId: string }
  | { type: 'transcript'; text: string; final?: boolean }
  | { type: 'chunk'; kind: 'text'; text?: string; done: boolean }
  | { type: 'chunk'; kind: 'audio'; audio?: string; done: false }
  | { type: 'action'; actions: CoBuildAction[] }
  | { type: 'summary'; summary: SessionSummaryPayload; reason?: string }
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
   * The player's live recognized speech, from the latest `transcript` frame. The
   * server streams it as recognition builds (cumulative `text`, reset per
   * utterance), so this updates on every interim frame to drive a live subtitle
   * and is replaced by the next utterance's first interim. Empty until the first
   * transcript arrives; a no-speech turn sends none, so the prior value persists.
   */
  playerTranscript: string
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
  summary: SessionSummaryPayload | null
  /**
   * The terminal `summary` frame's optional `reason` (reward-economy §5). The
   * server sets `'balance-depleted'` when the session ended because the starburst
   * budget ran out mid-conversation (the burn-through wind-down), so the panel can
   * show a depletion / earn-more beat rather than a plain clean close. `null` for
   * an ordinary `end`-driven summary.
   */
  summaryReason: string | null
}

export const initialVoiceState: VoiceSessionState = {
  status: 'idle',
  sessionId: null,
  aiText: '',
  playerTranscript: '',
  turnDone: true,
  error: null,
  summary: null,
  summaryReason: null,
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

    case 'transcript':
      // Live player subtitle. The server streams the recognized utterance as it
      // builds: each frame's `text` is the CUMULATIVE text so far (interim frames
      // grow it; the `final` frame settles the full utterance), and the running
      // text resets per utterance. So always storing the latest `text` both builds
      // the subtitle up within an utterance AND replaces it on the next utterance's
      // first interim — no append, no boundary bookkeeping, and `final` needs no
      // behavioral branch (a missing flag is non-terminal-safe). It does not touch
      // `aiText`, the turn boundary, or status — the AI reply streams independently.
      return { ...state, playerTranscript: frame.text }

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
      // A terminal summary lands `closed` and exposes the summary payload. The
      // optional `reason` (`'balance-depleted'` on a burn-through wind-down)
      // rides alongside so the panel can distinguish a budget-depletion end from
      // an ordinary `end`; absent on a normal close (reset to null).
      return {
        ...state,
        status: 'closed',
        summary: frame.summary,
        summaryReason: frame.reason ?? null,
      }

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
