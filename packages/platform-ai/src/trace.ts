/**
 * Curated structured turn tracing for production observability.
 *
 * Selected high-value voice-turn boundaries (turn start / settle, ASR final,
 * LLM first-token / end, TTS first-frame / finished, and any timeout/error
 * code) emit ONE structured line through these helpers, greppable in Cloudflare
 * Workers observability: filter on the log message containing `turn-trace`
 * (equivalently the JSON field `t == "turn-trace"`). Pure instrumentation — it
 * adds no control flow and changes no timing.
 *
 * Zero-leakage contract — enforced by the {@link TraceFields} type, not just by
 * convention. A trace line may carry ONLY: bounded enum reasons, numeric
 * counts / lengths / byte-tallies / durations / status + close codes / token
 * metering, booleans, and a closed set of stable, non-content correlation
 * identifiers (`sessionId`, `logid`, `resource`). It may NEVER carry a raw
 * provider error payload, a WebSocket close-reason string, transcript / prompt
 * text, or any other free-form string sourced from a provider or socket. The
 * type has no open string index signature, so `{ message: err.message }` or
 * `{ reason: event.reason }` is a compile error — a verbatim-payload log is
 * hard to write by accident.
 */

/**
 * The only fields a `turn-trace` line may carry. Closed by design: adding a new
 * field requires editing this interface, which forces a reviewer to confirm the
 * value is a count / code / duration / boolean / stable id — never content.
 */
export interface TraceFields {
  // --- Stable correlation identifiers (random/opaque, never user content) ---
  /** Turn session id (session-do) or TTS synthesize-session id (volcengine). */
  sessionId?: string
  /** Volcengine `X-Tt-Logid` handshake trace id (provider-log correlation). */
  logid?: string
  /** Volcengine resource-id enum selecting the ASR vs TTS endpoint (constant). */
  resource?: string

  // --- Bounded enum reasons (closed union — never raw provider/socket text) ---
  /** Why the LLM SSE stream ended. */
  streamEndReason?: 'done-sentinel' | 'done-sentinel-at-close' | 'body-closed-no-sentinel'

  // --- Durations / timing (ms) ---
  elapsedMs?: number
  ms?: number
  idleMs?: number

  // --- Counts ---
  turnCount?: number
  deltaCount?: number
  llmDeltaCount?: number
  sentenceCount?: number
  frameCount?: number
  ttsFrameCount?: number

  // --- Lengths / byte tallies (counts of content, never the content) ---
  transcriptChars?: number
  assistantChars?: number
  /** Length of an error/exception message — a char count, never the text. */
  messageChars?: number
  /** Length of a WebSocket close-reason string — a char count, never the text. */
  reasonChars?: number
  frameBytes?: number
  /** Byte length of a provider error payload — never its decoded text. */
  payloadBytes?: number
  ttsAudioBytes?: number

  // --- Token / usage metering ---
  inputTokens?: number
  outputTokens?: number
  llmInputTokens?: number
  llmOutputTokens?: number
  sttInputSeconds?: number
  ttsOutputSeconds?: number

  // --- Status / close codes ---
  status?: number
  code?: number

  // --- Booleans / flags ---
  finalReached?: boolean
  sessionFinished?: boolean
}

/** Emit one info-level `turn-trace` line. */
export function traceTurn(hop: string, stage: string, fields?: TraceFields): void {
  // eslint-disable-next-line no-console -- console.log is the Workers observability sink.
  console.log(JSON.stringify({ t: 'turn-trace', hop, stage, ...fields }))
}

/** Emit one error-level `turn-trace` line (same shape, error severity). */
export function traceTurnError(hop: string, stage: string, fields?: TraceFields): void {
  console.error(JSON.stringify({ t: 'turn-trace', level: 'error', hop, stage, ...fields }))
}
