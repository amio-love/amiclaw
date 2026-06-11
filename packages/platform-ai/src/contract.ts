/**
 * Four-method voice-session contract for the Platform AI Interface.
 *
 * This is the type-shape SSOT for the game-agnostic session orchestration
 * contract: `createSession` / `onPlayerAudio` / `onAiResponse` / `endSession`.
 * It defines the *semantic* contract only — the Durable Object / WebSocket
 * server that implements it lands in a later round.
 *
 * Architectural rationale lives in the L2 component spec
 * (arch-component-platform-ai-interface). Two load-bearing constraints from
 * that spec are encoded directly in these signatures:
 *
 *  1. The system prompt is NOT a `createSession` parameter. It is resolved
 *     server-side from `gameId` via `provider-config` (see `provider-config.ts`).
 *     Browser-side consumers connect over WebSocket and must never carry prompt
 *     material on the wire — this keeps "system prompt is server-side only"
 *     intact. Only the per-run `manualData` is passed in.
 *
 *  2. The contract is protocol-neutral: it names the session lifecycle
 *     (create / feed audio / receive response / end) without coupling to any
 *     vendor protocol. Provider-protocol differences are encapsulated inside
 *     each adapter (see `providers/types.ts`).
 */

/** Opaque server-issued identifier for a single voice collaboration session. */
export type SessionId = string

/** Identifier for a game registered in `provider-config` (e.g. 'yijing-oracle'). */
export type GameId = string

/** Already-authenticated user identifier, bound into the session on creation. */
export type UserId = string

/**
 * One inbound audio frame from the player, streamed in over the session
 * WebSocket. The platform-ai layer treats it as an opaque binary frame; the
 * STT adapter owns the concrete encoding/sample-rate contract.
 */
export type AudioChunk = Uint8Array

/**
 * Game-agnostic manual payload handed to the platform per run. The platform
 * deterministically selects a relevant subset by game state and injects it
 * into the LLM context (it does NOT rely on model function-calling to fetch
 * manual content). Kept structurally open here because each game's manual
 * schema differs; a concrete game (e.g. BombSquad) narrows `sections` to its
 * own typed manual shape at its call site.
 */
export interface ManualData {
  /** Manual version / build identifier, for provenance and cache keys. */
  version: string
  /**
   * Addressable manual sections keyed by a stable section id. The platform
   * selects a subset of these keys by game state for deterministic injection.
   * Values are intentionally untyped at the platform layer — the game owns the
   * concrete section schema.
   */
  sections: Record<string, unknown>
}

/**
 * One chunk of the AI's streamed response. A turn produces an ordered stream of
 * these: incremental assistant text plus the synthesized audio frames pushed
 * back over the same WebSocket. `kind` discriminates the two; `done` marks the
 * final chunk of a turn so the consumer can close out the turn without a
 * separate end signal.
 */
export interface AiResponseChunk {
  /** Which modality this chunk carries. */
  kind: 'text' | 'audio'
  /** Incremental assistant text (present when `kind === 'text'`). */
  text?: string
  /** Synthesized TTS audio frame (present when `kind === 'audio'`). */
  audio?: Uint8Array
  /** True on the last chunk of the current turn. */
  done: boolean
}

/**
 * Returned by `endSession`. Carries session metadata and the metering mount
 * point (token / audio-duration counters) for the downstream usage-metering
 * task. The platform-ai layer only *populates* these counts; aggregation by
 * user/date is a separate downstream component.
 */
export interface SessionSummary {
  sessionId: SessionId
  gameId: GameId
  userId: UserId
  /** Number of completed player->AI turns in this session. */
  turnCount: number
  /** Mount point for usage metering — concrete accounting is downstream. */
  usage: {
    /** LLM input tokens consumed across the session. */
    llmInputTokens: number
    /** LLM output tokens produced across the session. */
    llmOutputTokens: number
    /** STT input audio seconds sent to the speech provider. */
    sttInputSeconds: number
    /** TTS output audio seconds synthesized by the speech provider. */
    ttsOutputSeconds: number
  }
  // --- Companion-memory capture fields (additive; the four-method contract is
  // unchanged). These feed the companion-memory capture entry; each is
  // optional with pinned degradation semantics (companion-memory L2 §capture
  // input contract):
  //   no `highlights`  -> only settlement facts are consolidated (no claims);
  //   no `gameRunId`   -> the summary and the run's settlement event
  //                       consolidate independently (no merge);
  //   no `userId`      -> the capture entry drops the summary (anonymous
  //                       sessions never produce memories — enforced there,
  //                       since `userId` is non-optional on this contract).
  // The capture event id is keyed off `sessionId`, which is minted fresh per
  // session assembly (never a DO-derived id — see `AssembledSession.sessionId`),
  // so replays of one run dedup while distinct runs never collide.
  /**
   * Conversation highlights — the memory-consolidation raw material. v1
   * populates a deterministic excerpt of the session transcript (see
   * `companion-capture.ts` `summarizeHighlights`); richer summarization is the
   * consolidation LLM's job downstream.
   */
  highlights?: string[]
  /**
   * Join key correlating this summary with the same run's game settlement
   * event (e.g. the game run id the consumer supplied at `create`).
   */
  gameRunId?: string
  /** ISO 8601 session-end timestamp (capture provenance metadata). */
  occurredAt?: string
}

/**
 * The four-method session contract. Implemented by the Durable Object backed
 * server in a later round; defined here as the type-shape SSOT so consumers and
 * the future implementation share one contract.
 */
export interface VoiceSessionContract {
  /**
   * Create a voice collaboration session. Called by a game-specific consumer
   * with the game id, the already-authenticated user id, and this run's manual
   * data. The platform resolves the game's system-prompt config from `gameId`
   * via `provider-config` (the consumer does NOT pass a system prompt),
   * assembles the system prompt, initializes session state, and returns a
   * `SessionId`.
   */
  createSession(gameId: GameId, userId: UserId, manualData: ManualData): Promise<SessionId>

  /**
   * Feed one player audio frame into the session. Drives the
   * STT -> LLM -> TTS turn pipeline. Fire-and-forget at the contract level; the
   * resulting AI output surfaces via `onAiResponse`.
   */
  onPlayerAudio(sessionId: SessionId, audioChunk: AudioChunk): Promise<void>

  /**
   * Subscribe to the session's AI response stream — incremental assistant text
   * and synthesized audio frames. Semantic placeholder: does not promise a
   * synchronous or one-shot shape.
   */
  onAiResponse(sessionId: SessionId): AsyncIterable<AiResponseChunk>

  /**
   * End the session: close the long connection, settle session state, and
   * return the `SessionSummary` (for the metering mount point and ops review).
   */
  endSession(sessionId: SessionId): Promise<SessionSummary>
}
