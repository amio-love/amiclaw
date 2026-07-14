/**
 * `VoiceSessionDO` — the Durable Object that carries one voice session.
 *
 * It is a thin shell over the testable orchestration in `turn-pipeline.ts`:
 *   - It holds the session state (gameId/userId binding, conversation history,
 *     game state, usage counters) created in `createSession`.
 *   - It binds and tears down the session (`createSession` / `endSession`),
 *     enforcing `sessionId <-> userId` ownership on every operation.
 *   - It drives LIVE, per-utterance ASR over the WebSocket. The client owns turn
 *     detection (its VAD): on `speech-start` the DO opens a 火山 recognizer and
 *     feeds the live incoming audio frames to it immediately, streaming interim
 *     `{type:'transcript', final:false}` frames back so the caption builds WHILE
 *     the player speaks; on `turn` it finalizes (negative-sequence end packet ->
 *     last-package final), emits the terminal `{type:'transcript', final:true}`,
 *     then runs the LLM+TTS reply, serializing outbound `AiResponseChunk`s back to
 *     the player. The two phases are `runUtteranceStt` (speech-start) and
 *     `runReply` (turn); their end-to-end composition `runTurn` backs the
 *     unit-tested pipeline. Audio is streamed to 火山 continuously DURING the
 *     utterance and end-of-audio is signaled promptly on `turn`, so 火山's 8s
 *     inter-packet timeout cannot fire on a normal utterance.
 *   - On `create` it also fires an AI-first opening greeting (`runOpeningTurn`,
 *     LLM->TTS, no player audio) so the AI speaks first, when enabled (default).
 *
 * The orchestration logic itself lives in `runUtteranceStt` / `runReply` (and
 * their composition `runTurn`) / `runOpeningTurn` (pure, provider-mocked unit
 * tests); this class is the DO/WS adapter that drives the two phases live.
 *
 * The class extends the Cloudflare Agents SDK `Agent` base (over `partyserver`),
 * with hibernation deliberately OFF (`static options = { hibernate: false }`).
 * The SDK owns the WS lifecycle through the `onConnect` / `onMessage` / `onClose`
 * hooks (no manual `WebSocketPair` / `server.accept()` / `addEventListener`), and
 * the resident instance keeps the in-memory session state
 * (`sessionState` / `providers`) valid between a `create` and a later `turn`.
 * Enabling hibernation would drop that in-memory state on an idle-eviction
 * between turns — rejecting the next message as "turn before create" and losing
 * history; turn-based voice sessions have short idle windows, so the cost saving
 * does not justify persisting + rehydrating session state per message
 * (L2 §Open Questions — "WebSocket Hibernation 是否启用"). partyserver assigns
 * `binaryType = 'arraybuffer'` on each connection (so binary audio frames
 * normally arrive as `ArrayBuffer` in `onMessage`), but it does so AFTER
 * `accept()`; `onMessage`'s binary branch does not rely on that assignment — it
 * recovers the frame bytes defensively for whatever shape the runtime delivers
 * (`ArrayBuffer` / `ArrayBufferView` / `Blob`, see `audioFrameToBytes`). The
 * SDK's own protocol/text frames are suppressed via `shouldSendProtocolMessages`
 * so they never collide with the hand-rolled JSON envelope channel.
 *
 * The authenticated user id forwarded by the Worker is bound PER CONNECTION
 * (via `SocketIdentityRegistry`, keyed by the SDK `Connection`), not in a shared
 * instance field: two already-authenticated clients can connect to the same-named
 * DO (one instance), and a shared field would let the later connection overwrite
 * the earlier client's identity — letting connection B drive `create`/`reset`
 * under connection A's user. Both inbound paths resolve the id of the exact
 * connection a frame arrived on and verify it owns the bound session: control
 * messages (create/turn/end) and binary audio frames alike. The binary path must
 * gate too — otherwise a second authenticated connection on the same DO could
 * push audio onto the owner's shared bridge, which the owner's next `turn` would
 * transcribe (forging the owner's utterance). So the per-operation ownership
 * invariant (L2 §Mechanism Variant 3) holds per connection across every inbound
 * frame, not just control messages.
 *
 * Two ownership grains coexist, split by what the operation does:
 *  - DRIVE operations (`speech-start`, `turn`, binary audio) are gated on the
 *    owner USER id: the operating socket's authenticated user must equal the bound
 *    owner. They open / finalize an utterance and feed audio; they never clear the
 *    session.
 *  - TEARDOWN operations (`end`, owner socket close) are gated on the owner
 *    SOCKET reference — the exact socket recorded at `createSession`
 *    (`ownerSocket` / `socketIsBoundSessionOwner`). A user-id grain is too coarse
 *    here: the SAME user's second socket (a duplicate tab / reconnect) shares the
 *    owner's user id, so a user-id gate would let that duplicate's `end` or close
 *    `clearSession()` the still-active original session and truncate its turn.
 *    Pinning teardown to the creator socket means only the socket that opened the
 *    session can end it; every other socket's `end`/close (same user or not)
 *    touches nothing but its own per-socket binding.
 */

import { Agent, type Connection, type ConnectionContext, type WSMessage } from 'agents'
import type { CompanionDb } from '../../companion-memory/src/db'
import { resolveCompanionContext } from '../../companion-memory/src/resolver'
import { MIN_SESSION_BALANCE } from '../../companion-memory/src/economy'
import {
  creditWelcomeGrant,
  deductSessionMinutes,
  readBalance,
} from '../../companion-memory/src/ledger'
import type { CompanionContext } from '../../companion-memory/src/types'
import {
  handOffSummaryCapture,
  summarizeHighlights,
  type ConsolidatorNamespace,
} from './companion-capture'
import type {
  AiResponseChunk,
  AudioChunk,
  ManualData,
  RecapOutcome,
  SessionSummary,
} from './contract'
import type { GameState } from './manual-injection'
import type { ProviderEnv } from './providers/factory'
import { assembleSession } from './session-assembly'
import { traceTurn, traceTurnError } from './trace'
import { validateShadowChaseVoiceContext } from './shadow-chase-voice-context'
import { validateSoundGardenVoiceContext } from './sound-garden-voice-context'
import {
  runClosingTurn,
  runOpeningTurn,
  runReply,
  runUtteranceStt,
  type SessionState,
  type TurnProviders,
  type UtteranceResult,
} from './turn-pipeline'
import { flushSessionUsage, type UsageKvWriter } from './usage-flush'
import {
  assertSessionOwnership,
  assertSocketOwnsBoundSession,
  socketIsBoundSessionOwner,
  SocketIdentityRegistry,
} from './auth-seam'

/**
 * Env bindings visible to the DO: provider creds, the optional USAGE KV the
 * session-terminal metering flush writes to, and the OPTIONAL
 * companion-memory bindings (Companion D1 for the assembly-time resolver
 * read; the consolidator DO namespace for the end-of-session capture
 * hand-off). All three are optional by design — a deploy without `USAGE`
 * skips the flush fail-open (see `usage-flush.ts`); absent companion
 * bindings degrade to a memory-less session, never an error.
 */
export type SessionDoEnv = ProviderEnv & {
  USAGE?: UsageKvWriter
  COMPANION_DB?: CompanionDb
  COMPANION_CONSOLIDATOR?: ConsolidatorNamespace
} & Record<string, unknown>

/** The DO accepts a single session-control message kind plus binary audio. */
interface CreateSessionMessage {
  type: 'create'
  gameId: string
  manualData: ManualData
  gameState?: GameState
  /**
   * Optional join key correlating this session's summary with the run's
   * settlement event (companion-memory capture contract). Pass-through
   * metadata only — it never affects session behaviour.
   */
  gameRunId?: string
  /**
   * The player's current ACCOUNT streak in days (B9 叙事型成长). Optional and
   * client-asserted — it only shapes the companion's TONE (register + memory
   * budget), never a security decision. The client resolves it account-first
   * (arcade-profile `resolveAccountStreak`: account API primary, cached value
   * on failure, device-local only as a last-resort stale fallback) so the
   * relationship's familiarity is account-anchored, not per-device. Absent (or
   * below the first familiarity tier) leaves the assembled prompt byte-identical
   * to the pre-B9 shape.
   */
  streakDays?: number
  /**
   * Whether the AI opens the conversation with an unprompted greeting turn
   * (LLM->TTS, no player audio) right after the session is established. Defaults
   * to `true` — AI-first is the product behaviour. A consumer (or a test) sets
   * `false` to suppress the greeting.
   */
  opening?: boolean
}

/**
 * The player began an utterance (the client VAD detected speech start). The DO
 * OPENS a per-utterance 火山 ASR connection and starts feeding the live incoming
 * audio frames to it immediately, streaming interim `{type:'transcript',
 * final:false}` frames back as the recognizer stabilizes more text — so the
 * caption builds WHILE the player speaks. Paired with exactly one later `turn`.
 * A second `speech-start` (or one while the AI is replying — a barge-in)
 * supersedes the prior utterance / cancels the in-flight reply and opens a fresh
 * recognizer.
 */
interface SpeechStartMessage {
  type: 'speech-start'
}

/**
 * The player stopped (the client VAD detected utterance end). The DO finalizes
 * the open utterance — closing the audio bridge so the ASR pump sends the
 * negative-sequence end-of-audio packet and 火山 returns the last-package final —
 * emits the terminal `{type:'transcript', final:true}` frame, then runs the
 * existing LLM+TTS reply over the complete transcript. A `turn` with no open
 * utterance (no prior `speech-start`, or it was already finalized / barged-in
 * away) is a benign no-op.
 */
interface TurnMessage {
  type: 'turn'
}

/**
 * The player typed a question instead of speaking — the text fallback (FP1
 * option A, probe-branch only). Feeds `text` DIRECTLY to the LLM as the turn's
 * transcript, skipping STT entirely, then runs the SAME LLM+TTS reply path a
 * voice `turn` uses (`runReply`) — including the terminal transcript frame (the
 * typed text echoed) and usage accounting (STT cost is zero: no audio).
 * Game-agnostic and additive: it needs no prior `speech-start` and does not
 * touch the live-utterance / ASR path. Serial with voice turns (rejected with
 * `turn_in_flight` mid-reply); an empty/whitespace `text` is a benign no-op; a
 * `text-turn` with no live session fail-louds exactly like `turn`.
 */
interface TextTurnMessage {
  type: 'text-turn'
  text: string
}

interface EndSessionMessage {
  type: 'end'
}

/**
 * Steer the live session's manual injection mid-conversation. Sent by the client
 * when the player advances modules within ONE continuous run: the whole-run
 * voice session stays a single conversation (history + the AI-first greeting
 * persist), and only WHICH manual subset is injected changes. The DO updates the
 * stored session `gameState.relevantSections` so the NEXT turn injects the new
 * module's manual; it does NOT create a new session, reset history, re-run the
 * greeting, or disturb an in-flight turn. `manualData` (the whole manual) was
 * already provided at `create` — this only re-selects sections from it.
 */
interface UpdateGameStateMessage {
  type: 'update-gamestate'
  gameState: GameState
}

/**
 * Request the closing-recap turn. Sent by the client at settlement BEFORE the
 * results screen appears. The DO runs one final LLM+TTS recap turn (1-2
 * sentences, spoken Chinese) and streams it back via the normal `AiResponseChunk`
 * channel. `outcome` picks the recap register (win congratulation vs facts-only
 * failure recap); absent defaults to `defused`. The `{type:'end'}` message
 * follows after the client navigates away — this message does NOT end the session.
 */
interface ClosingSessionMessage {
  type: 'closing'
  outcome?: RecapOutcome
}

/**
 * Server-side cap on a `text-turn`'s typed text. A botanist question is a short
 * prompt; a client caps it too, but the DO must not trust the client — an
 * over-long payload is TRUNCATED (not rejected) so a benign over-run still gets
 * answered, and a hostile one cannot bloat the LLM context. Generous vs the
 * client bound so normal input is never clipped.
 */
const MAX_TEXT_TURN_CHARS = 2000

/**
 * Hard per-turn wall-clock cap, in milliseconds. A single provider turn (opening
 * greeting, player reply, closing recap, or burn-through wind-down) that overruns
 * this bound is force-canceled by `streamTurn` (hardening batch B FIX 2). The
 * provider adapters already bound their CONNECT / FIRST-RESPONSE / inter-chunk
 * idle windows (`providers/timeout.ts`), so a hung provider normally fails loud
 * within ~20 s; this is the generic OUTER belt for the residual case a provider's
 * `await` escapes those guards (an un-wrapped mock in a test, or a producer that
 * trickles chunks slowly forever). Its load-bearing job: a STUCK turn must not
 * pin `turnInFlight` forever, because a burn-through wind-down deferred behind a
 * live turn (finding 1) only fires when that turn's `streamTurn` finally releases
 * the guard — a never-releasing turn would leak free minutes past a depleted
 * budget. 120 s is far above any healthy voice turn (a spoken-Chinese reply is a
 * few seconds of TTS) yet bounds a runaway to a small, one-time overage. Named
 * (not magic) so it is one-line tunable, mirroring `providers/timeout.ts`.
 */
const MAX_TURN_DURATION_MS = 120_000

/**
 * Durable payload carried by the burn-through wind-down DO alarm (hardening batch
 * B FIX 1). The Agents-SDK `schedule()` persists this as a JSON row in the DO's
 * SQLite storage, so it survives an isolate eviction: when the alarm fires on a
 * FRESH instance (in-memory `sessionState` gone), the callback still has the
 * identity + budget it needs to bill the depleted session durably. Kept minimal —
 * only what the eviction-path deduct requires.
 */
interface BurnThroughPayload {
  sessionId: string
  userId: string
  budgetMinutes: number
  fundingSource: string
}

/**
 * DO-storage key prefix for the durable "this session delivered billable output"
 * marker (hardening batch B round 2, Finding #2). Written to `ctx.storage` on a
 * session's first delivered chunk and deleted at teardown; it survives an isolate
 * eviction (unlike the in-memory `hasDeliveredTurn` latch), so the burn-through
 * alarm can tell a delivered-but-evicted session (bill the budget) from a
 * zero-delivery session (bill ZERO — FIX 3 wrote no teardown deduct row). Keyed by
 * session id (a UUID), so markers never collide across the DO's reused lifetime.
 */
const BILLABLE_KEY_PREFIX = 'reward:billable:'

type ControlMessage =
  | CreateSessionMessage
  | SpeechStartMessage
  | TurnMessage
  | TextTurnMessage
  | EndSessionMessage
  | UpdateGameStateMessage
  | ClosingSessionMessage

function normalizeVoiceGameState(gameId: string, gameState: GameState | undefined): GameState {
  const relevantSections = gameState?.relevantSections
  if (
    !Array.isArray(relevantSections) ||
    !relevantSections.every((sectionId) => typeof sectionId === 'string')
  ) {
    throw new Error('session-do: invalid game state')
  }
  if (gameId === 'shadow-chase') {
    const validated = validateShadowChaseVoiceContext(gameState?.publicContext)
    if (!validated.ok) {
      throw new Error(`session-do: invalid shadow chase context (${validated.reason})`)
    }
    return { relevantSections: [...relevantSections], publicContext: validated.value }
  }
  if (gameId === 'sound-garden') {
    // The board snapshot is optional at the protocol layer: absent = no board
    // injected this turn (the game always pushes one in normal play, but a bare
    // `create` without one is benign). When present it is UNTRUSTED input that
    // gets injected into the prompt, so it is validated + bounded before it is
    // trusted; an invalid board is rejected loudly.
    if (gameState?.publicContext === undefined) {
      return { relevantSections: [...relevantSections] }
    }
    const validated = validateSoundGardenVoiceContext(gameState.publicContext)
    if (!validated.ok) {
      throw new Error(`session-do: invalid sound garden context (${validated.reason})`)
    }
    return { relevantSections: [...relevantSections], publicContext: validated.value }
  }
  return { relevantSections: [...relevantSections] }
}

/**
 * Base64-encode raw bytes for JSON transport of an audio frame. Uses the
 * Workers-runtime global `btoa` over a latin1 string built byte-by-byte (the
 * frames are small per-sentence TTS chunks, so this stays cheap).
 */
function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Normalize an inbound binary WS frame to its raw bytes, defensively, regardless
 * of how the runtime types it. partyserver assigns `binaryType = 'arraybuffer'`
 * (so frames normally arrive as `ArrayBuffer`), but it does so AFTER
 * `connection.accept()`; this conversion does NOT rely on that assignment having
 * happened or on any compat-date default. Each delivered binary shape is handled
 * for its exact bytes:
 *  - `ArrayBuffer` — wrap directly (the production hot path).
 *  - `ArrayBufferView` (typed array / `DataView`) — wrap over its exact byte
 *    range (`byteOffset` + `byteLength`), so a subview never grabs the whole
 *    backing buffer.
 *  - `Blob` — the newer `compatibility_date` default for an accepted socket whose
 *    `binaryType` was not set before `accept()`; read its bytes via
 *    `arrayBuffer()` (awaitable — `onMessage` is already `async`). A naive
 *    `new Uint8Array(blob)` would yield an EMPTY view, silently feeding empty
 *    audio to STT.
 * Anything else is rejected (the caller's try/catch turns the throw into a 1008
 * close), consistent with the control path's fail-loud stance.
 */
export async function audioFrameToBytes(
  message: ArrayBuffer | ArrayBufferView | Blob
): Promise<Uint8Array> {
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message)
  }
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
  }
  if (typeof (message as Blob).arrayBuffer === 'function') {
    return new Uint8Array(await (message as Blob).arrayBuffer())
  }
  throw new Error('unsupported binary audio frame type')
}

/** Max bytes the WebSocket spec allows for a close reason (UTF-8 encoded). */
const MAX_CLOSE_REASON_BYTES = 123

/**
 * Clamp a WebSocket close reason to the spec's 123-UTF-8-byte limit, truncating
 * by BYTES (never UTF-16 code units) so a multibyte string can never exceed the
 * cap. Passing an over-long reason to `connection.close()` throws
 * `SyntaxError: WebSocket close reason must not be longer than 123 bytes` — and
 * on the error path (where the reason is a provider error string) that throw
 * crashes the fail-loud close itself, parking the turn silently instead of
 * surfacing a clean 1008. A char-based `slice(0, 123)` is NOT enough: 123 chars
 * of multibyte text is up to ~369 bytes. This truncates on a UTF-8 code-point
 * boundary (never splitting a multibyte sequence) so the result is always valid
 * UTF-8 and ≤123 bytes.
 */
export function safeCloseReason(reason: string): string {
  const encoded = textEncoderForReason.encode(reason)
  if (encoded.length <= MAX_CLOSE_REASON_BYTES) return reason
  // Walk back from the byte budget to the start of the last whole code point so
  // the truncation never splits a multibyte UTF-8 sequence (continuation bytes
  // match 0b10xxxxxx).
  let end = MAX_CLOSE_REASON_BYTES
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1
  }
  return textDecoderForReason.decode(encoded.subarray(0, end))
}

const textEncoderForReason = new TextEncoder()
const textDecoderForReason = new TextDecoder()

/**
 * Capacity of the rolling pre-roll audio buffer, in bytes of PCM16 16 kHz audio.
 * 16 000 samples/s × 0.7 s × 2 bytes/sample = 22 400 bytes (≈700 ms).
 * This covers the client VAD's `minSpeechMs: 400 ms` qualification window plus
 * margin for the leading consonant / onset that fires before VAD qualifies.
 */
export const PREROLL_MAX_BYTES = 22_400

/**
 * Async audio bridge: binary WS frames are pushed in; the STT step pulls them via
 * `for await`. One bridge backs one live utterance: it is created on
 * `speech-start` (the recognizer opens and starts pulling LIVE while the player
 * speaks) and `close()`d on `turn` (so the ASR pump sends the negative-sequence
 * end-of-audio packet and the stream terminates). A teardown / barge-in also
 * closes it.
 */
class AudioBridge {
  private buffer: AudioChunk[] = []
  private resolvers: Array<(r: IteratorResult<AudioChunk>) => void> = []
  private closed = false

  push(chunk: AudioChunk): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve({ value: chunk, done: false })
    } else {
      this.buffer.push(chunk)
    }
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      this.resolvers.shift()?.({ value: undefined, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AudioChunk> {
    for (;;) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as AudioChunk
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<AudioChunk>>((resolve) => {
        this.resolvers.push(resolve)
      })
      if (next.done) return
      yield next.value
    }
  }
}

/**
 * One live, per-utterance ASR session: the bridge audio frames are pushed into,
 * the background STT driver's completion promise, and the captured outcome / a
 * genuine ASR fault. Opened on `speech-start`, consumed on `turn`, fenced by its
 * own `epoch` so a barge-in / teardown that advanced the session generation
 * stops its late interim frames and swallows its late faults.
 */
interface LiveUtterance {
  /** The audio bridge live frames are pushed into; closed on `turn` to finalize. */
  bridge: AudioBridge
  /** The session generation this utterance belongs to (epoch-fencing). */
  epoch: number
  /** Resolves when the background STT driver settled (populating `outcome`/`error`). */
  done: Promise<void>
  /** The captured complete utterance + audio byte total, once STT finalized cleanly. */
  outcome?: UtteranceResult
  /** A genuine ASR fault (error frame / connect failure / idle stall), if STT failed. */
  error?: unknown
}

export class VoiceSessionDO extends Agent<SessionDoEnv> {
  /**
   * Stay resident across turns — hibernation OFF. Load-bearing: it preserves the
   * in-memory session state (`sessionState` / `providers` / `turnInFlight` /
   * `activeTurn` / `turnEpoch` / `socketIdentities` / `ownerSocket`) between a
   * `create` and a later `turn`, exactly as the prior `server.accept()`
   * (non-hibernation) DO did. partyserver assigns `binaryType = 'arraybuffer'`
   * on each connection (after `accept()`); `onMessage` does not depend on it,
   * recovering binary audio bytes defensively for whatever shape the runtime
   * delivers (see `audioFrameToBytes`).
   */
  static options = { hibernate: false }

  /**
   * Session state, set on `create`; `undefined` until then. Named `sessionState`
   * (not `state`) because the `Agent` base reserves a public `state` member for
   * its SQLite state API — Phase 1 does not use it.
   */
  private sessionState: SessionState | undefined
  /** Bound user id, set on `create`; ownership checks compare against it. */
  private userId: string | undefined
  /**
   * The bound session's opaque id — a UUID minted fresh per `createSession`
   * (see `session-assembly.ts` for why it is NOT the DO id), `undefined` when
   * no session is bound. Every ownership check, WS protocol message, and the
   * usage-flush key carry this value, never `ctx.id`.
   */
  private sessionId: string | undefined
  /**
   * Whether THIS session's usage has been flushed to the USAGE KV. Set at
   * `create` (false) and flipped by `flushUsage`, so the flush runs exactly
   * once per session no matter how many terminal paths fire (`endSession` +
   * owner-socket close). Generation-safe by construction: a new `create`
   * starts a new session with a fresh `false`, so the guard never bleeds
   * across the `clearSession` epoch boundary.
   */
  private usageFlushed = false
  /**
   * Whether THIS session's minute deduct has been written to the ledger — the
   * sibling of `usageFlushed` for the reward-economy teardown (L2 §5, finding 8).
   * `finalizeSessionAccounting` is called from BOTH `endSession` and the
   * owner-socket close path; this single guard makes the negative ledger row
   * fire exactly once across the two terminal paths. Reset at `create` /
   * `clearSession`, so it never bleeds across the session generation boundary.
   */
  private deductFlushed = false
  /**
   * Whether THIS session ever DELIVERED at least one turn's output to the player —
   * set true the first time `streamTurn` sends any chunk (the opening greeting OR
   * any player / closing / wind-down turn). Gates the 1-minute billing floor in
   * `finalizeSessionAccounting` (hardening batch B FIX 3): a session that closed
   * before ANY turn delivered (e.g. the opening greeting threw before its first
   * chunk) is billed ZERO — the floor's justification (the greeting is real
   * LLM+TTS cost) only holds once the greeting actually delivered. Reset at
   * `create` / `clearSession`, so it never bleeds across the session generation.
   */
  private hasDeliveredTurn = false
  /**
   * The burn-through wind-down alarm's schedule id, set at `create` when the
   * session has a finite starburst budget (L2 §5). Migrated from a WS-resident
   * `setTimeout` to the Agents-SDK durable `schedule()` API (hardening batch B
   * FIX 1): the Agent base RESERVES the DO `alarm()` handler for its own
   * scheduling, so we do NOT override `alarm()` — we drive `this.schedule(delay,
   * 'onBurnThroughAlarm', payload)`, which persists a SQLite schedule row that
   * survives an isolate eviction. So a depleted budget still tears down + deducts
   * even if the DO was evicted mid-session (the eviction undercount the setTimeout
   * left is now closed). `undefined` when no budget alarm is armed; cleared /
   * canceled on any earlier teardown (`clearSession`) and when the alarm fires
   * (`onBurnThroughAlarm`).
   */
  private burnScheduleId: string | undefined
  /**
   * Seconds of wall-clock per billed minute — the burn-through alarm delay basis
   * (`budgetMinutes × this`, in SECONDS, as the SDK `schedule()` number form
   * expects). `60` in production; a workerd test overrides it to a small value so
   * a real schedule fires the wind-down deterministically fast (the §11.iv alarm
   * fire obligation), without fake timers. The SDK stores schedule `time` at
   * 1-second granularity, so sub-second acceleration is not meaningful — the
   * deterministic suites drive `onBurnThroughAlarm` / `runDurableObjectAlarm`
   * directly rather than racing a fractional-second wall clock.
   */
  private burnSecondsPerMinute = 60
  /**
   * Hard per-turn wall-clock cap in ms (hardening batch B FIX 2), initialized from
   * {@link MAX_TURN_DURATION_MS}. A workerd test overrides it to a small value so a
   * stuck-turn force-cancel fires fast with a real timer (no fake timers).
   */
  private maxTurnMs = MAX_TURN_DURATION_MS
  /** Wired providers for the session. */
  private providers: TurnProviders | undefined
  /**
   * The live, in-progress utterance, if any: set on `speech-start` (the
   * recognizer opens and starts feeding on live audio), consumed + cleared on
   * `turn` (finalize), and discarded on barge-in / teardown. `undefined` between
   * utterances. Incoming binary audio frames are forwarded to its bridge ONLY
   * while it is set; frames arriving with no live utterance (between utterances,
   * during the AI-first greeting) are dropped.
   */
  private liveUtterance: LiveUtterance | undefined
  /**
   * Reply in-flight guard. A voice reply is a single serial round; a DO event can
   * interleave across the many `await`s inside one reply (LLM/TTS all await), so a
   * second `turn` message arriving mid-reply would start a second `runReply` over
   * the SAME `state`/`providers`/socket — racing the shared `history`/`usage` and
   * interleaving two response streams on one socket. This flag is `true` for
   * exactly the window one reply is running; a second `turn` while set is rejected
   * (fail-loud), and it is cleared in the reply loop's `finally` so success /
   * failure / cancel all release it (an exception can never wedge the guard shut).
   */
  private turnInFlight = false
  /**
   * The in-flight reply's async iterator, held so a mid-reply `end` (or the
   * owner's socket close, or a barge-in `speech-start`) can cancel it cleanly:
   * `return()` on this iterator runs `runReply`'s `finally` (closes the sentence
   * queue, returns the live LLM/TTS iterators) so no provider stream is left
   * dangling. `undefined` when no reply is running.
   */
  private activeTurn: AsyncIterator<AiResponseChunk> | undefined
  /**
   * A deferred burn-through wind-down, set when the budget timer fires WHILE a
   * turn is in flight (L2 §5, finding 1 — the wind-down recap must not overlap a
   * live turn). Holds the owner socket to wind down; consumed by `streamTurn`'s
   * `finally` the instant the in-flight turn fully drains, which re-invokes
   * `windDown` (now with no turn in flight) so the recap runs strictly AFTER the
   * live turn — never concurrently. Cleared on any teardown (`clearSession`), so a
   * pending wind-down can never fire against a later session generation.
   * `undefined` when no wind-down is pending.
   */
  private pendingWindDown: Connection | undefined
  /**
   * Monotonic session-generation counter — the epoch guard that keeps a stale
   * turn-loop `finally` from clobbering a NEWER session's shared `turnInFlight`/
   * `activeTurn`.
   *
   * The race it closes: `end`/owner-close fire-and-forget a mid-turn cancel
   * (`cancelActiveTurn` is NOT awaited — a provider promise may still be
   * pending) and then `clearSession()` makes the same-named DO immediately
   * reusable. The canceled turn's loop `finally` still runs LATER, when its
   * iterator finally settles. If a client reconnects in that window — `create`s
   * a fresh session and starts a NEW turn (setting fresh `turnInFlight`/
   * `activeTurn`) — an UNCONDITIONAL clear in the stale `finally` would
   * (1) reopen the overlap guard (the new session becomes attackable by an
   * overlapping `turn`) and (2) null out the new `activeTurn` so the new turn
   * can no longer be canceled by `end`. Root cause: cleanup wrote shared fields
   * across the "old turn generation" / "new session generation" boundary.
   *
   * Mechanism: every turn captures its own generation (`myEpoch`) the instant it
   * becomes active. Both the turn loop `finally` and `clearSession`'s reset only
   * touch the shared fields while the current epoch still matches the captured
   * one. `clearSession` (end / owner-close) bumps the epoch, advancing the
   * generation, so a stale `finally` comparing an old `myEpoch` is a no-op and
   * never reaches the new session's state. A new `create` does not need to bump:
   * `clearSession` already advanced the epoch at the prior session's end, and
   * `create` does not start a turn (no `myEpoch` is captured until the first
   * `turn`). Normal single-session flow is unchanged — the epoch only advances on
   * teardown, so a turn that completes within its own live session always finds
   * its epoch current and clears as before.
   */
  private turnEpoch = 0
  /**
   * Authenticated user id per accepted socket, forwarded by the Worker from the
   * validated handshake (`X-Session-User-Id`). This is the authoritative
   * identity bound at upgrade — the client-supplied control message is NOT
   * trusted for it. Keyed by socket so two clients on the same DO instance keep
   * separate identities and cannot overwrite each other.
   */
  private readonly socketIdentities = new SocketIdentityRegistry<Connection>()
  /**
   * The exact socket that created/bound the session (recorded in `createSession`),
   * or `undefined` when no session is bound. This is the OWNER socket: only its
   * close tears the session down (`onSocketClose`).
   *
   * Tracking the owner by socket reference — not by user id — is what stops a
   * same-user duplicate socket (a second tab / a reconnect to the same
   * `/ai-ws/{sessionName}` DO) from clearing the still-active original session
   * when that duplicate socket closes. A user-id match would mark the duplicate
   * as an owner; the recorded-socket identity does not. Cleared in
   * `clearSession` so a torn-down session leaves no stale owner reference.
   */
  private ownerSocket: Connection | undefined
  /**
   * Rolling ring-buffer of audio frames received while no live utterance is open
   * (between utterances, during the AI-first greeting). Frames are appended on
   * every binary WS message when `liveUtterance` is undefined and evicted (oldest
   * first) to keep the retained total within `PREROLL_MAX_BYTES`. On
   * `speech-start`, the buffered frames are prepended to the new `AudioBridge`
   * before live frames begin flowing, so the onset audio (leading consonant +
   * first syllable) that arrived before the client VAD qualified is captured by
   * the recognizer.
   */
  private prerollFrames: Uint8Array[] = []
  /** Running byte total of `prerollFrames` (avoids a per-frame reduce scan). */
  private prerollBytes = 0

  /**
   * Suppress the SDK's own protocol/text frames (identity, `cf_agent_state`, MCP
   * server lists). This session speaks a hand-rolled JSON envelope
   * (`{type:'created'|'chunk'|'summary'|'error'}`) on the same text channel, so
   * an SDK frame would pollute the client's `JSON.parse` + `type` switch. Phase 1
   * also never calls `setState`, so there is no agent state to sync outbound.
   */
  override shouldSendProtocolMessages(_connection: Connection, _ctx: ConnectionContext): boolean {
    return false
  }

  /**
   * A connection is established (the SDK has already accepted it — no manual
   * `accept()` / hibernation, see `static options`). The Worker forwards the
   * already-auth-validated upgrade carrying the resolved user id in
   * `X-Session-User-Id`; bind that id to THIS connection (so a second client on
   * the same DO cannot overwrite it). A connection with no forwarded identity is
   * closed — the Worker only forwards validated upgrades, so this is
   * defense-in-depth.
   */
  override onConnect(connection: Connection, ctx: ConnectionContext): void {
    const forwardedUserId = ctx.request.headers.get('X-Session-User-Id')
    if (!forwardedUserId) {
      connection.close(1008, safeCloseReason('missing authenticated identity'))
      return
    }
    this.socketIdentities.bind(connection, forwardedUserId)
  }

  /**
   * Inbound WS frame: a JSON control message (string) or an audio frame (binary).
   * Fail loud — an ownership violation or a malformed control message ends THIS
   * connection with a 1008 policy close rather than leaking an unhandled
   * rejection (the SDK would otherwise route it to `onError`); other connections
   * on the DO are unaffected. This try/catch replaces the prior message-listener
   * `.catch` with byte-identical close semantics.
   */
  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    try {
      if (typeof message === 'string') {
        await this.handleControl(connection, JSON.parse(message) as ControlMessage)
        return
      }
      // Binary frame: player audio. Gate it through the SAME per-socket ownership
      // predicate the control path uses — a binary frame must come from the
      // connection whose user owns the bound session. Without this, a second
      // authenticated connection on the same DO could push frames into the owner's
      // live recognizer, forging the owner's utterance. The throw on a non-owner
      // frame is caught below and closes THAT connection with 1008 (fail loud,
      // control-path-consistent) — the owner's utterance is never touched. The
      // frame's bytes are recovered defensively for whatever shape the runtime
      // delivers (`ArrayBuffer` / `ArrayBufferView` / `Blob`), so audio fidelity
      // never depends on partyserver's post-accept `binaryType = 'arraybuffer'`
      // assignment (see `audioFrameToBytes`).
      //
      // The mic streams continuously, so frames arrive between utterances and
      // during the AI-first greeting too; they are forwarded to the recognizer
      // ONLY while a live utterance is open (between `speech-start` and `turn`)
      // and otherwise dropped. Feeding the open recognizer live — rather than
      // buffering for a transcribe-at-`turn` — is what keeps 火山's 8s
      // inter-packet timeout from firing and surfaces the caption WHILE the player
      // speaks.
      this.assertSocketOwner(connection)
      const bytes = await audioFrameToBytes(message)
      if (this.liveUtterance !== undefined) {
        // Utterance open: forward directly to the live recognizer bridge.
        this.liveUtterance.bridge.push(bytes)
      } else {
        // No utterance open: accumulate into the rolling pre-roll ring buffer.
        // On the next `speech-start`, these frames are prepended to the new
        // bridge so the recognizer captures the onset audio that arrived before
        // the client VAD qualified (≈400 ms qualification window).
        this.prerollFrames.push(bytes)
        this.prerollBytes += bytes.byteLength
        // Evict oldest frames until the retained total is within cap.
        while (this.prerollBytes > PREROLL_MAX_BYTES && this.prerollFrames.length > 0) {
          this.prerollBytes -= this.prerollFrames.shift()!.byteLength
        }
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'message handling failed'
      // Byte-safe truncation: `reason` is a provider error string of unbounded
      // length / arbitrary UTF-8. A char-based `slice(0, 123)` could still hand
      // `close()` a >123-byte reason (multibyte text) and throw, crashing this
      // fail-loud close and parking the turn. `safeCloseReason` caps it to ≤123
      // UTF-8 bytes so the turn always fails LOUD with a clean 1008.
      connection.close(1008, safeCloseReason(reason))
    }
  }

  /** A connection closed: release its identity and tear down only if it owned. */
  override onClose(connection: Connection): void {
    this.onSocketClose(connection)
  }

  /**
   * Socket closed. Always release THIS socket's identity binding (so the
   * registry never leaks). Tear down the shared audio bridge / in-flight turn
   * ONLY when the closing socket is the OWNER socket — the exact socket that
   * created the session (`socketIsBoundSessionOwner`).
   *
   * Without this gate the close path is the one un-gated mutation of shared
   * session state. Two clients can reach this DO and trigger a wrongful teardown:
   *  - a DIFFERENT user's socket on the same `/ai-ws/{name}` DO — already blocked
   *    by the prior user-id gate; and
   *  - the SAME user's SECOND socket (a duplicate tab / a reconnect) — NOT blocked
   *    by a user-id gate, because its user id equals the owner's. Its close would
   *    have cleared the still-active original session and truncated the owner's
   *    in-flight turn. Gating on the owner SOCKET reference (not the user id)
   *    closes that path: only the creator socket's close tears down; every other
   *    socket's close (same user or not) releases just its own binding.
   * Ownership is checked with the total (non-throwing) predicate because a close
   * handler must never throw.
   */
  private onSocketClose(ws: Connection): void {
    const ownsSession = socketIsBoundSessionOwner(ws, this.ownerSocket, this.boundIdentity())
    this.socketIdentities.release(ws)
    if (!ownsSession) return
    // Owner gone: cancel any in-flight turn so its LLM/TTS streams are returned
    // (`runTurn`'s `finally`) rather than left dangling, then close the next-turn
    // bridge and clear the bound session. The turn loop's `finally` (which clears
    // `turnInFlight` and `activeTurn`) runs when the `return()` settles.
    // `cancelActiveTurn` is total and idempotent — a no-op when no turn is
    // running. Fire-and-forget here because `onSocketClose` is a sync (total)
    // close handler; the cancel's cleanup is best-effort on a socket that is
    // already gone.
    //
    // `cancelActiveTurn` MUST run BEFORE `clearSession` (it captures the live
    // `activeTurn` synchronously — see `clearSession`). The owner's socket
    // closing — whether via `end` (which already cleared the session, so this
    // owner branch is not reached: `boundIdentity` is empty and `ownsSession` is
    // false) or via an abrupt drop with no `end` — terminates the session, so
    // we clear ALL session-level state, not just the bridge. Otherwise the
    // abrupt-drop path leaves `state`/`userId`/`providers` bound on this resident
    // DO: a later same-name reconnect authenticated as the same user could then
    // `turn` with no fresh `create` and run a provider turn on the dropped
    // session. Clearing makes that reconnect open a clean new session via
    // `create` and reject a create-less `turn` ("turn before create").
    //
    // Abrupt-drop is a session-TERMINAL path that never reaches `endSession`
    // (the contract-level flush boundary), so it carries its own usage flush —
    // between the cancel (a canceled turn never settles, so its partial usage
    // is excluded: undercount-only) and the clear (the flush reads the live
    // session fields). After an `end`, this branch is unreachable (see above),
    // so the flush cannot double-fire across the two paths — and the
    // `usageFlushed` guard backstops it regardless.
    void this.cancelActiveTurn()
    this.finalizeSessionAccounting()
    this.flushUsage()
    this.clearSession()
  }

  // --- Four-method contract semantics ---

  /**
   * Create the session: bind the (already-authenticated) `userId`, resolve the
   * game's provider/prompt config, wire the providers, and initialize state.
   * Returns the freshly minted opaque `SessionId` — a per-session UUID from
   * `assembleSession`, NOT the DO id (the resident DO hosts many logical
   * sessions over its lifetime; see `AssembledSession.sessionId`).
   *
   * Publish-after-success (all-or-nothing): every fallible setup step —
   * `resolveConfig` (unregistered game) and `createProviders` (a selected real
   * provider missing its secret) — runs inside `assembleSession` into LOCALS
   * first. Only once the whole bundle exists are
   * `userId`/`sessionId`/`providers`/`state` assigned, in one synchronous block
   * with no `await` and no throw between the first and last publish.
   * `boundIdentity()` derives the session's ownership binding solely from these
   * published fields, so observers only ever see a session that is fully
   * constructed or entirely absent — never half-bound. The prior interleaving
   * (`this.userId = userId` BEFORE `createProviders`) let a failed create leave
   * the DO bound to a user with NO `state`/`providers`: that user's frames then
   * passed the ownership gate. In the live model frames are only ever forwarded
   * to an OPEN utterance (set on `speech-start`, never on a bare `create`), so
   * the publish-after-success ordering still matters for the gate but no longer
   * risks a leaked-frame carry-over.
   */
  createSession(
    gameId: string,
    userId: string,
    manualData: ManualData,
    gameState?: GameState,
    extras?: { companionContext?: CompanionContext; gameRunId?: string; budgetMinutes?: number }
  ): string {
    const normalizedGameState = normalizeVoiceGameState(
      gameId,
      gameState ?? { relevantSections: [] }
    )
    const assembled = assembleSession(
      gameId,
      userId,
      manualData,
      normalizedGameState,
      this.env,
      extras
    )
    // Atomic publish — nothing below this line can throw or await.
    this.sessionId = assembled.sessionId
    this.userId = assembled.userId
    this.providers = assembled.providers
    this.sessionState = assembled.state
    this.usageFlushed = false
    this.deductFlushed = false
    this.hasDeliveredTurn = false
    return assembled.sessionId
  }

  /**
   * End the session: validate ownership, settle, flush the session's usage to
   * the USAGE KV, and return the summary with the turn count and usage mount
   * point.
   *
   * The flush lives HERE — in the session-teardown method — because `endSession`
   * is the single implementation boundary every `end`-shaped termination goes
   * through: the WS `end` branch calls this method, and a direct consumer driving
   * the session contract over the DO stub reaches it without any WS framing.
   * Hanging the flush on the WS branch instead would let a direct teardown call
   * end a session unmetered. The owner-socket close path keeps
   * its own `flushUsage()` — an abrupt drop never reaches `endSession` (see
   * `onSocketClose`). State is still live at this point, so the flush
   * naturally precedes any `clearSession` the caller performs. A mid-flight
   * turn's partial usage stays excluded (undercount-only, per the locked
   * metering stance): usage counters are written only when a turn settles,
   * and no `await` separates this snapshot from the teardown that cancels
   * the turn.
   */
  endSession(sessionId: string, userId: string): SessionSummary {
    this.assertOwner(sessionId, userId)
    if (!this.sessionState) {
      throw new Error('session-do: endSession before createSession')
    }
    // Terminate any open live utterance's recognizer (closing its bridge ends the
    // STT stream); `clearSession` discards the handle. A reply in flight is
    // canceled separately by the `end` path's `cancelActiveTurn`.
    this.discardLiveUtterance()
    const summary: SessionSummary = {
      sessionId,
      gameId: this.sessionState.config.gameId,
      userId,
      turnCount: this.sessionState.turnCount,
      usage: { ...this.sessionState.usage },
      // Companion-memory capture fields (additive). Highlights are the
      // deterministic transcript excerpt — the consolidation LLM summarizes
      // downstream, outside the session boundary. The capture side keys its
      // event off `sessionId` above, which is minted fresh per assembly (see
      // `AssembledSession.sessionId`) — naturally per-run, so two runs on this
      // same-named DO can never collide on the capture key.
      highlights: summarizeHighlights(this.sessionState.history),
      ...(this.sessionState.gameRunId !== undefined
        ? { gameRunId: this.sessionState.gameRunId }
        : {}),
      occurredAt: new Date().toISOString(),
    }
    // Reward-economy deduct (L2 §5): bill the session's minutes in one negative
    // ledger row, the sibling of the usage flush below. Both read the still-live
    // session fields here, before any `clearSession`, and each is guarded to fire
    // exactly once across `endSession` + the owner-close path.
    this.finalizeSessionAccounting()
    this.flushUsage()
    return summary
  }

  // --- Internals ---

  /**
   * Resolve the companion context for an authenticated user at session
   * assembly. Total: returns `undefined` (memory-less session) when the
   * Companion D1 binding is absent, the user has no companion, or the read
   * fails for any reason — the resolver read is an enhancement on the create
   * path, never a dependency of it.
   */
  private async resolveCompanionContextBestEffort(
    userId: string,
    gameId: string,
    streakDays?: number
  ): Promise<CompanionContext | undefined> {
    const db = this.env.COMPANION_DB
    if (db === undefined) return undefined
    try {
      const context = await resolveCompanionContext(db, userId, gameId, undefined, streakDays)
      return context ?? undefined
    } catch (error) {
      console.warn('session-do: companion-context resolution failed (memory-less session)', error)
      return undefined
    }
  }

  /**
   * Read the session's starburst budget at `create` (reward-economy L2 §5), on
   * the existing `COMPANION_DB` binding — `create` is a session BOUNDARY, not a
   * voice-turn, so a D1 read here honors "no D1 in the hot path". First mints the
   * idempotent welcome grant (a brand-new user gets +10 so a first-ever session
   * opens), THEN reads the balance AFTER the grant. Total / fail-open:
   *  - no `COMPANION_DB` binding (dev/demo) -> `Infinity` (a priceless session);
   *  - any D1 failure -> `Infinity` (never block a session on a read failure).
   * The returned number is the minute budget (1 starburst = 1 minute).
   */
  private async readSessionBudgetBestEffort(userId: string): Promise<number> {
    const db = this.env.COMPANION_DB
    if (db === undefined) return Infinity
    try {
      await creditWelcomeGrant(db, userId)
      return await readBalance(db, userId)
    } catch (error) {
      console.warn('session-do: session-budget read failed (priceless session)', error)
      return Infinity
    }
  }

  /**
   * Open a fresh live utterance on `speech-start`: discard any prior live
   * utterance (a second `speech-start` without an intervening `turn`), cancel an
   * in-flight AI reply and free the serial-turn guard (barge-in — the player took
   * the floor while the AI was replying / greeting), then start the per-utterance
   * STT driver over a new bridge. Incoming audio frames feed this bridge LIVE, so
   * 火山 transcribes WHILE the player speaks and the DO streams interim caption
   * frames; `turn` closes the bridge to finalize.
   *
   * The new utterance captures the CURRENT generation (post-`supersedeActiveTurn`
   * bump) as its epoch, so a later barge-in / teardown that advances the epoch
   * fences this utterance's late interim frames and swallows its late faults
   * (see `runLiveStt` / the `turn` finalize guard).
   */
  private beginUtterance(ws: Connection): void {
    this.discardLiveUtterance()
    this.supersedeActiveTurn()
    const bridge = new AudioBridge()
    // Flush buffered pre-roll frames (onset audio that arrived before the client
    // VAD qualified) into the new bridge so the recognizer captures the full
    // utterance from its actual start. Clear after flush: these frames are
    // consumed once and must not carry over to a subsequent utterance.
    for (const frame of this.prerollFrames) {
      bridge.push(frame)
    }
    this.prerollFrames = []
    this.prerollBytes = 0
    const myEpoch = this.turnEpoch
    const utterance: LiveUtterance = {
      bridge,
      epoch: myEpoch,
      // Replaced synchronously below; the placeholder keeps `done` non-optional.
      done: Promise.resolve(),
    }
    utterance.done = this.runLiveStt(ws, bridge, myEpoch).then(
      (outcome) => {
        utterance.outcome = outcome
      },
      (err) => {
        utterance.error = err
        // Fail loud on a GENUINE ASR fault that surfaced mid-utterance (before
        // `turn`) — but only while this utterance is still the live generation. A
        // barge-in / teardown that advanced the epoch already moved on; its late
        // ASR fault must not 1008-close a socket the new generation owns. A
        // benign no-speech close is NOT a fault (it resolves with an empty
        // transcript, not a rejection), so it never reaches here.
        if (this.turnEpoch === myEpoch) {
          const reason = err instanceof Error ? err.message : 'live ASR failed'
          traceTurnError('asr', 'live-error', {
            sessionId: this.sessionId,
            messageChars: reason.length,
          })
          try {
            ws.close(1008, safeCloseReason(reason))
          } catch {
            // socket already gone — nothing to fail loud on.
          }
        }
      }
    )
    this.liveUtterance = utterance
  }

  /**
   * Drive the per-utterance STT phase: pull the player's audio off `bridge`,
   * stream each interim cumulative transcript to the client as a live caption
   * frame (`{type:'transcript', final:false}`) AS IT ARRIVES, and resolve to the
   * complete utterance + audio byte total once the stream ends (bridge close on
   * `turn`, or a benign no-speech close). A genuine ASR fault throws out (handled
   * fail-loud by `beginUtterance` / the `turn` finalize). Interim frames are
   * suppressed once the epoch advances (barge-in / teardown), so a superseded
   * utterance never paints stale caption text onto the new generation's socket.
   */
  private async runLiveStt(
    ws: Connection,
    bridge: AudioBridge,
    myEpoch: number
  ): Promise<UtteranceResult> {
    if (!this.providers) throw new Error('session-do: speech-start before createSession')
    const gen = runUtteranceStt(this.providers, bridge, this.sessionId)[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = await gen.next()
        if (next.done) return next.value
        const chunk = next.value
        if (this.turnEpoch === myEpoch && chunk.kind === 'transcript') {
          ws.send(
            JSON.stringify({
              type: 'transcript',
              text: chunk.text ?? '',
              final: chunk.final ?? false,
            })
          )
        }
      }
    } finally {
      // Defensive cleanup on an early (throwing) exit: terminate the STT
      // generator so its upstream is returned. A no-op on the normal done path
      // (the generator already completed). The return value is discarded — the
      // cast satisfies the generator's typed `TReturn`.
      await gen.return(undefined as unknown as UtteranceResult)
    }
  }

  /**
   * Discard the live utterance, if any: close its bridge so its STT stream
   * terminates (a benign no-speech close — the captured outcome / late frames are
   * fenced by the epoch). Idempotent; a no-op when no utterance is open.
   */
  private discardLiveUtterance(): void {
    const utterance = this.liveUtterance
    if (utterance === undefined) return
    this.liveUtterance = undefined
    utterance.bridge.close()
  }

  /**
   * Free the serial-turn guard for a NEW turn in the SAME session — the barge-in
   * case (the player speaks while the AI is replying / greeting). Mirrors
   * `clearSession`'s epoch mechanism WITHOUT clearing the session: capture the
   * in-flight turn, bump `turnEpoch` (so the superseded turn's late `finally` is a
   * no-op against the new generation — it cannot reopen the guard or null the new
   * `activeTurn`), reset the guard synchronously, then `return()` the captured
   * iterator (fire-and-forget — `return()` cannot interrupt a pending provider
   * `await`, so it must not block). A no-op (beyond a harmless epoch bump) when no
   * turn is in flight.
   */
  private supersedeActiveTurn(): void {
    const turn = this.activeTurn
    this.turnEpoch += 1
    this.turnInFlight = false
    this.activeTurn = undefined
    if (turn !== undefined) {
      // Fence a LATE settle by this barge-in'd turn whose provider ignored `return()`
      // (a stuck `await`): bump the turn generation so its commit path is a no-op if
      // it completes after this supersession (same fence as the force-cancel path).
      // Only when a turn is actually superseded — a `speech-start` with nothing
      // playing has no turn to fence, so it must not perturb the generation.
      if (this.sessionState) this.sessionState.turnGeneration += 1
      void turn.return?.(undefined)
    }
  }

  /**
   * Reset every session-level mutable field back to the "no active session"
   * initial state. Called by the `end` path after the summary is produced (and
   * after a mid-turn cancel has been INITIATED) so the ended session leaves no
   * residue on this resident DO instance.
   *
   * Without this, the DO keeps `state`/`userId`/`providers` bound after `end`
   * (no hibernation — the instance is resident for the worker's lifetime). The
   * next client reconnecting to the same-named DO would then (a) be wrongly
   * rejected with `already_created` on `create` (the session is over, a fresh
   * one should open) and (b) — worse — a `turn` with no new `create` would pass
   * `assertOwner` against the stale binding and run a provider turn on an
   * already-ended session. Clearing the binding makes a post-`end` `turn` fail
   * "turn before create" and a post-`end` `create` open a clean new session.
   *
   * Coordination with the fire-and-forget cancel (`end` does NOT await the
   * cancel — see the `end` branch): the caller MUST initiate
   * `cancelActiveTurn()` BEFORE calling this, because that helper captures the
   * live `activeTurn` synchronously; once captured, clearing the field here is
   * safe (the captured iterator drives the background `return()` independently).
   * The background cancel only runs `runTurn`'s `finally` (closes the sentence
   * queue, returns the live LLM/TTS iterators) and the turn loop's own `finally`.
   * A canceled turn never reaches `runTurn`'s settle step, so it never writes
   * back to the (now undefined) `state`.
   *
   * Epoch advance — the cross-generation guard: bumping `turnEpoch` here
   * advances the session generation, so the just-canceled (or any still-draining)
   * turn's loop `finally`, which captured the OLD epoch, no longer matches and
   * becomes a no-op. Without this, that stale `finally` settling AFTER a client
   * reconnected + started a NEW turn would null out the NEW session's
   * `turnInFlight`/`activeTurn` — reopening the overlap guard and stranding the
   * new turn (uncancelable by `end`). The current-generation `turnInFlight`/
   * `activeTurn` reset below still clears the ended session's own state; the
   * epoch bump only fences off the stale generation's late callback. Bump BEFORE
   * the field reset so any `finally` that interleaves already sees the advanced
   * epoch.
   */
  private clearSession(): void {
    this.turnEpoch += 1
    // Cancel the burn-through wind-down alarm for this now-torn generation (FIX 1).
    // Best-effort + idempotent: `cancelSchedule` deletes the durable schedule row,
    // registered on the DO lifecycle via `ctx.waitUntil` so the delete completes
    // without blocking the (synchronous) teardown. A cancel that races a
    // just-fired alarm is harmless — `onBurnThroughAlarm` already cleared the id
    // and its work is idempotent on `session:{sessionId}`. Skipped when no alarm
    // is armed or it already fired (`burnScheduleId` undefined).
    if (this.burnScheduleId !== undefined) {
      const scheduleId = this.burnScheduleId
      this.burnScheduleId = undefined
      this.ctx.waitUntil(this.cancelSchedule(scheduleId).catch(() => {}))
    }
    // Drop the durable billable marker for this session (Finding #2 cleanup) — ONLY
    // when one was actually written (i.e. this session delivered output). A delivered
    // session already wrote its teardown deduct row, so a later stale alarm reading
    // the now-absent marker bills zero harmlessly (idempotency already covers the
    // double-bill). A zero-delivery session never wrote a marker, so it skips the
    // delete entirely (no stray storage op). Prevents markers accumulating across the
    // DO's lifetime while keeping teardown side-effect-free for zero-output sessions.
    if (this.sessionId !== undefined && this.hasDeliveredTurn) {
      const endingSessionId = this.sessionId
      this.ctx.waitUntil(
        this.ctx.storage.delete(`${BILLABLE_KEY_PREFIX}${endingSessionId}`).catch(() => {})
      )
    }
    // Drop any deferred wind-down (finding 1): the session is torn down, so a
    // pending wind-down must never fire against the next generation.
    this.pendingWindDown = undefined
    this.sessionState = undefined
    this.userId = undefined
    this.sessionId = undefined
    this.providers = undefined
    // Discard any open live utterance (closes its bridge -> STT terminates). The
    // epoch bump above fences its late interim frames / faults from this just-torn
    // generation, exactly as it fences a stale turn `finally`.
    this.discardLiveUtterance()
    this.turnInFlight = false
    this.activeTurn = undefined
    this.ownerSocket = undefined
    this.usageFlushed = false
    this.deductFlushed = false
    this.hasDeliveredTurn = false
    this.prerollFrames = []
    this.prerollBytes = 0
  }

  /**
   * Flush the ended session's usage counters to the USAGE KV — exactly once
   * per session, reached from the two terminal boundaries: the public
   * `endSession` body (which the WS `end` branch goes through) and the
   * owner-socket close path (an abrupt drop never reaches `endSession`).
   * MUST run BEFORE `clearSession` (it reads the live session fields) and is
   * idempotent against double-firing: the `usageFlushed` guard flips on the
   * first call, and a fresh `create` resets it, so the guard can neither
   * double-write one session nor suppress the next session's flush (the
   * cross-generation misfire the `turnEpoch` comments warn about — this guard
   * is per-session state reset at `create`, not a field that survives the
   * generation boundary).
   *
   * The KV write runs in the background, registered on the DO lifecycle via
   * `ctx.waitUntil` and never awaited here (fail-open): `flushSessionUsage`
   * never rejects — an absent binding skips, a put failure logs — so a slow
   * or failing KV can never block or delay session teardown / socket close,
   * while the registration keeps the runtime from reclaiming an
   * otherwise-idle DO before the pending put settles. The remaining loss
   * window is only a termination that runs no callbacks at all (deploy
   * eviction / crash / OOM) — the accepted undercount-only cost, per the
   * locked L2 metering stance.
   */
  private flushUsage(): void {
    const state = this.sessionState
    const sessionId = this.sessionId
    const userId = this.userId
    if (!state || sessionId === undefined || userId === undefined) return
    if (this.usageFlushed) return
    this.usageFlushed = true
    // Turn-trace: session usage flush — the terminal accounting boundary. A
    // park shows up here as turnCount:0 / llmOutputTokens:0 (the deploy task's
    // last sighting), so this line is the after-the-fact confirmation of which
    // hops produced nothing.
    traceTurn('session', 'usage-flush', {
      sessionId,
      turnCount: state.turnCount,
      llmInputTokens: state.usage.llmInputTokens,
      llmOutputTokens: state.usage.llmOutputTokens,
      sttInputSeconds: state.usage.sttInputSeconds,
      ttsOutputSeconds: state.usage.ttsOutputSeconds,
    })
    this.ctx.waitUntil(
      flushSessionUsage(this.env.USAGE, {
        sessionId,
        userId,
        gameId: state.config.gameId,
        turnCount: state.turnCount,
        usage: { ...state.usage },
        sttSource: state.sttSource,
        fundingSource: state.fundingSource,
      })
    )
  }

  /**
   * Deduct the session's billed minutes in ONE negative ledger row — the sibling
   * of `flushUsage`, reached from BOTH `endSession` and the owner-socket close
   * path, guarded by the single `deductFlushed` boolean so it writes exactly once
   * across the two terminal boundaries (L2 §5, finding 8). Billed minutes =
   * `min(ceil(elapsed / 60_000), budgetMinutes)` with a floor of 1 — any
   * established session bills at least a minute (its opening greeting is real
   * LLM+TTS cost, finding iii).
   *
   * Fail-open, undercount-only, non-blocking:
   *  - no `COMPANION_DB` binding (dev/demo) -> skip (a priceless session);
   *  - no `budgetMinutes` established -> skip (gate/deduct fail-open SYMMETRY): a
   *    transient D1 failure in the create-gate admits the session priceless
   *    (`readSessionBudgetBestEffort` returns Infinity, so no `budgetMinutes` is
   *    threaded), so the deduct must also fail open — otherwise it would bill the
   *    UNCAPPED full elapsed if D1 recovered by teardown, an asymmetry that
   *    charges the user for a session the gate priced at zero;
   *  - a non-finite `startedAtMs` -> skip (the NaN-poison invariant, finding 9 —
   *    a NaN amount would permanently poison `SUM(amount)` and can never be
   *    written; `deductSessionMinutes` refuses it too, belt and braces);
   *  - NO turn ever delivered output -> skip (hardening batch B FIX 3): a session
   *    that closed before a single turn's chunk reached the player (an opening
   *    greeting that threw before its first chunk, so the player got nothing)
   *    bills ZERO. The 1-minute floor below assumes the greeting is real LLM+TTS
   *    cost; that assumption only holds once a turn actually delivered, so a
   *    zero-value session is not charged the floor (consistent with the dev/demo
   *    skip). `hasDeliveredTurn` latches true on the first `streamTurn` chunk.
   *  - the deduct rides `ctx.waitUntil` and swallows its own D1 failure, so a
   *    slow or failing ledger never blocks or delays session teardown.
   * `deductSessionMinutes` writes `source_ref = 'session:' + fundingSource`
   * (v1 `'session:earned'`) under the unique `session:{sessionId}` key, so a
   * double-fired teardown is a no-op regardless of the guard.
   */
  private finalizeSessionAccounting(): void {
    if (this.deductFlushed) return
    this.deductFlushed = true
    const db = this.env.COMPANION_DB
    const state = this.sessionState
    const sessionId = this.sessionId
    const userId = this.userId
    if (db === undefined || !state || sessionId === undefined || userId === undefined) return
    if (!Number.isFinite(state.startedAtMs)) return
    // Symmetry with the fail-open create-gate: a session admitted priceless (no
    // budget established because the balance read threw) is never billed. This is
    // distinct from the dev/demo no-COMPANION_DB case, which already returned above.
    if (state.budgetMinutes === undefined) return
    // FIX 3 — no turn ever delivered output: bill ZERO (the floor below assumes a
    // delivered greeting's LLM+TTS cost). Skips the deduct entirely for a
    // zero-value session, exactly like the dev/demo skip above.
    if (!this.hasDeliveredTurn) return
    const elapsed = Math.max(1, Math.ceil((Date.now() - state.startedAtMs) / 60_000))
    const minutes = Math.min(elapsed, state.budgetMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    traceTurn('session', 'deduct', { sessionId, minutes })
    this.ctx.waitUntil(
      deductSessionMinutes(db, {
        userId,
        sessionId,
        minutes,
        fundingSource: state.fundingSource,
      }).catch((err: unknown) => {
        // Fail-open: a D1 failure is an accepted undercount, never a teardown block.
        console.error(`platform-ai: session deduct failed for session:${sessionId}`, err)
      })
    )
  }

  /**
   * Send a structured, non-fatal error signal on a socket WITHOUT closing it.
   * Used for reject-the-message-not-the-connection cases (an overlapping `turn`,
   * a re-`create`) where a 1008 close would also truncate a turn streaming on
   * the same socket. Distinct from the listener's 1008 close, which is reserved
   * for ownership / protocol violations that must terminate the socket.
   */
  private sendError(ws: Connection, code: string, message: string): void {
    ws.send(JSON.stringify({ type: 'error', code, message }))
  }

  /**
   * Cleanly cancel the in-flight turn, if any. Closing the audio bridge (done by
   * the caller) terminates the STT step; here we `return()` the held turn
   * iterator, which resumes `runTurn` at its suspension point and runs its
   * `finally` (closes the sentence queue, returns the live LLM/TTS iterators) so
   * no provider stream is left dangling. The turn loop's own `finally` then
   * clears `turnInFlight`/`activeTurn`. Total and idempotent: a no-op when no
   * turn is running, and `return()` on an already-finished iterator is harmless.
   */
  private async cancelActiveTurn(): Promise<void> {
    const turn = this.activeTurn
    if (turn === undefined) return
    await turn.return?.(undefined)
  }

  /**
   * Stream one reply's `AiResponseChunk`s to the socket under the serial-turn
   * guard, shared by the client-`turn` reply path (the terminal transcript frame +
   * LLM->TTS via `runReply`) and the AI-first opening greeting (LLM->TTS via
   * `runOpeningTurn`). The live INTERIM transcript frames are NOT streamed here —
   * they stream from `runLiveStt` during the utterance (between `speech-start` and
   * `turn`); `runReply` yields only the single terminal `final: true` transcript
   * frame, which this relays before the AI reply chunks.
   *
   * Holds the iterator explicitly (so a mid-reply `end` / owner close / barge-in
   * can cancel it via `return()`) and captures this reply's generation (`myEpoch`)
   * at the same synchronous point the shared `turnInFlight`/`activeTurn` fields are
   * set, so the `finally` clears the guard on every exit (normal end, provider
   * error, cancellation) — but ONLY while this reply is still the live generation:
   * a stale `finally` whose session was already ended/dropped/superseded must not
   * null out a newer generation's `turnInFlight`/`activeTurn` (see `turnEpoch`).
   *
   * Hard per-turn deadline (hardening batch B FIX 2): each `turn.next()` races a
   * single wall-clock deadline armed once per turn ({@link maxTurnMs}). If a
   * provider turn overruns it (a hung LLM/TTS whose `await` escapes the adapters'
   * own connect / idle guards), the loop force-cancels: it `return()`s the
   * iterator best-effort (which cannot interrupt a pending provider `await`, so it
   * is fire-and-forget) and breaks, so the `finally` releases `turnInFlight` and
   * fires any DEFERRED burn-through wind-down. Without this bound a stuck turn
   * would pin `turnInFlight` forever, and a wind-down deferred behind it (finding
   * 1) would never fire — leaking free minutes past a depleted budget. The bound
   * applies to EVERY turn kind and game (greeting / reply / recap / wind-down),
   * since all of them stream through here.
   *
   * Delivered-turn latch (FIX 3): the first chunk sent flips `hasDeliveredTurn`,
   * which gates the 1-minute billing floor at teardown.
   *
   * Takes a `makeTurn` FACTORY rather than a ready iterator so it owns the
   * AbortSignal (FIX 2): it mints one `AbortController` per turn, hands its signal
   * to the generator (which threads it into the LLM provider request), and aborts
   * it when the deadline trips — so a provider adapter honoring the signal unwinds
   * its in-flight fetch instead of leaking. The `turn.return()` + `break` still
   * releases the guard even for a provider that ignores the signal (the mock in the
   * stuck-turn test), so the wind-down/cutoff is never blocked either way.
   */
  private async streamTurn(
    ws: Connection,
    makeTurn: (signal: AbortSignal) => AsyncIterator<AiResponseChunk>
  ): Promise<void> {
    const myEpoch = this.turnEpoch
    // The session this turn belongs to. The loop body gates its session-facing writes
    // (delivered latch, chunk sends, billable marker) on THIS still being the bound
    // session — the precise "don't corrupt a DIFFERENT session" check. It is NOT the
    // epoch: a same-session barge-in advances `turnEpoch` but keeps `sessionId`, and a
    // superseded turn on the SAME session may still legitimately flush its farewell
    // (a depletion recap barged into mid-stream). Only a REBIND (a new `sessionId`
    // after `clearSession`) is corruption.
    const mySessionId = this.sessionId
    const abortController = new AbortController()
    const turn = makeTurn(abortController.signal)
    this.activeTurn = turn
    this.turnInFlight = true
    // Whether a `type:'chunk'` frame (audio/text — the frames the client keys its
    // mid-stream state on) has reached the player on THIS turn. Drives the terminal
    // frame the force-cancel path must send so the client is not left mid-stream.
    let deliveredChunk = false
    // One wall-clock deadline for the WHOLE turn (not per-chunk): armed here, raced
    // by every `turn.next()`, cleared in the `finally`. A legitimately long stream
    // is bounded per-chunk by the providers' own idle guards; this outer cap only
    // trips on a turn that never terminates at all.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<'deadline'>((resolve) => {
      deadlineTimer = setTimeout(() => resolve('deadline'), this.maxTurnMs)
    })
    try {
      for (;;) {
        const step = await Promise.race([turn.next(), deadline])
        if (step === 'deadline') {
          // The turn overran the hard per-turn cap (a stuck provider). Force-cancel:
          // ABORT the signal so a signal-honoring provider unwinds its in-flight
          // fetch, then best-effort `return()` (cannot interrupt a pending provider
          // `await`, so do NOT await it) and break so the `finally` releases the
          // guard and any deferred wind-down fires. The abandoned generator promise
          // settles later, exactly like the `end`-path fire-and-forget cancel.
          traceTurnError('turn', 'max-duration', {
            sessionId: this.sessionId,
            elapsedMs: this.maxTurnMs,
          })
          abortController.abort()
          void turn.return?.(undefined)
          // INVARIANT: a turn that no longer owns the epoch touches NOTHING on the
          // session. `return()` cannot interrupt a pending provider `await`, so this
          // deadline can fire LATE — after a barge-in / `end` advanced `turnEpoch`
          // and possibly rebound the DO to a NEW session. In that stale case, bumping
          // the generation or emitting a frame would corrupt the NEW session (its
          // legitimate turn would skip history/usage/terminal `done`). So gate every
          // session-facing write on `turnEpoch === myEpoch`. NB: when still current,
          // `turnEpoch` is deliberately NOT bumped — the `finally` must see
          // `turnEpoch === myEpoch` to release the guard and fire a deferred wind-down.
          if (this.turnEpoch === myEpoch) {
            // Fence a LATE settle: bump the turn generation so this turn's generator,
            // if its provider `await` resolves after the guard released, sees a stale
            // generation and SKIPS its commit (no `history` / usage / `turnCount`
            // mutation for the abandoned turn).
            if (this.sessionState) this.sessionState.turnGeneration += 1
            // Unstick the client (it clears mid-stream state only on a `done` frame
            // or a socket close): emit a terminal `done:true` if a chunk actually
            // streamed, so a partial-then-hung reply does not leave it stuck.
            if (deliveredChunk) {
              ws.send(JSON.stringify({ type: 'chunk', kind: 'text', text: '', done: true }))
            }
          }
          break
        }
        if (step.done) break
        // INVARIANT: a turn whose provider resolved a chunk LATE, after the DO was
        // REBOUND to a DIFFERENT session (`end`/close ran `clearSession` and a new
        // `create` bound a new `sessionId`), must touch NOTHING on that new session —
        // flipping its delivered latch or sending a frame would corrupt it (e.g.
        // floor-charge a rebound zero-output session). Keyed on session IDENTITY, not
        // epoch: a same-session barge-in advances the epoch yet the superseded turn
        // may still legitimately flush its farewell to the same socket.
        if (this.sessionId !== mySessionId) break
        const chunk = step.value
        // A chunk is about to reach the player: this (current-epoch) session has now
        // delivered real turn output (FIX 3 — gates the billing floor at teardown).
        if (!this.hasDeliveredTurn) {
          this.hasDeliveredTurn = true
          // Persist a DURABLE billable marker keyed to THIS session (Finding #2): it
          // survives eviction (unlike the in-memory latch), so the burn-through alarm
          // bills a session that delivered ZERO output nothing even when no teardown
          // deduct row exists (FIX 3) and its schedule-cancel raced. Written once, on
          // the false->true transition.
          const deliveredSessionId = this.sessionId
          if (deliveredSessionId !== undefined) {
            this.ctx.waitUntil(
              this.ctx.storage.put(`${BILLABLE_KEY_PREFIX}${deliveredSessionId}`, true)
            )
          }
        }
        if (chunk.kind === 'transcript') {
          // The player's recognized utterance — its OWN wire frame, NOT a
          // `chunk`: `{type:'transcript', text, final}`. Here this is the single
          // terminal frame (`final:true`, the complete utterance) `runReply`
          // yields before the AI reply chunks; the interim frames (`final:false`,
          // running cumulative text) already streamed live from `runLiveStt` while
          // the player spoke. `runReply` yields the terminal frame only for a
          // non-empty transcript (a no-speech turn sends none). It carries no
          // `done` — the AI reply's terminal `chunk` still closes the turn.
          ws.send(
            JSON.stringify({
              type: 'transcript',
              text: chunk.text,
              final: chunk.final,
            })
          )
        } else if (chunk.kind === 'audio') {
          deliveredChunk = true
          ws.send(
            JSON.stringify({
              type: 'chunk',
              kind: 'audio',
              audio: base64FromBytes(chunk.audio),
              done: chunk.done,
            })
          )
        } else if (chunk.kind === 'action') {
          // The partner's structured board moves (co_build games only) — its OWN
          // wire frame, NOT a `chunk`: `{type:'action', actions}`. It carries no
          // `done` (pinned `done:false` in the union), so the AI reply's terminal
          // text `chunk` still closes the turn. Absent for every non-co_build
          // game, so those games' wire streams are unchanged.
          ws.send(
            JSON.stringify({
              type: 'action',
              actions: chunk.actions,
            })
          )
        } else {
          deliveredChunk = true
          ws.send(
            JSON.stringify({
              type: 'chunk',
              kind: 'text',
              text: chunk.text,
              done: chunk.done,
            })
          )
        }
      }
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
      if (this.turnEpoch === myEpoch) {
        this.turnInFlight = false
        this.activeTurn = undefined
        // A budget depletion fired while this turn was streaming and DEFERRED the
        // wind-down (finding 1: the wind-down recap must not overlap a live turn).
        // Now that this turn has fully drained, re-invoke the deferred wind-down —
        // with no turn in flight it proceeds straight to the recap + teardown, so
        // the two turns are strictly serial. Gated by the epoch match above, so a
        // stale generation's `finally` never launches a wind-down against a newer
        // session (a torn-down session already reset `pendingWindDown`).
        const deferred = this.pendingWindDown
        if (deferred !== undefined) {
          this.pendingWindDown = undefined
          void this.windDown(deferred)
        }
      }
    }
  }

  /**
   * Fire the AI-first opening greeting: an LLM->TTS-only turn from the
   * server-side `OPENING_DIRECTIVE`, streamed to the socket with NO player audio.
   * Background-launched on `create` (when enabled), so it owns its own errors:
   * fail-loud (a provider error closes the OWNER socket with a 1008 policy close,
   * exactly as the synchronous control path does) and self-fencing (the epoch
   * guard inside `streamTurn` makes a stale `finally` a no-op, and the catch
   * skips the close once a teardown has advanced the generation). The synthetic
   * directive is never persisted and the greeting does not count as a player turn
   * (see `runOpeningTurn`).
   */
  private async runOpeningGreeting(ws: Connection): Promise<void> {
    const myEpoch = this.turnEpoch
    try {
      if (!this.sessionState || !this.providers || this.sessionId === undefined) return
      traceTurn('turn', 'opening-start', { sessionId: this.sessionId })
      const providers = this.providers
      const state = this.sessionState
      await this.streamTurn(ws, (signal) =>
        runOpeningTurn(providers, state, signal)[Symbol.asyncIterator]()
      )
    } catch (err: unknown) {
      // Skip the fail-loud close once a teardown has advanced the generation
      // (the session this greeting belonged to is gone; a newer session may own
      // the socket now).
      if (this.turnEpoch === myEpoch) {
        const reason = err instanceof Error ? err.message : 'opening greeting failed'
        traceTurnError('turn', 'opening-error', {
          sessionId: this.sessionId,
          messageChars: reason.length,
        })
        try {
          ws.close(1008, safeCloseReason(reason))
        } catch {
          // socket already gone — nothing to fail loud on.
        }
      }
    }
  }

  /**
   * Fire the closing-recap turn: an LLM+TTS-only turn from the server-side
   * `CLOSING_DIRECTIVE`, streamed to the socket with NO player audio. Mirrors
   * `runOpeningGreeting` in structure: background-launched on `closing`
   * (fire-and-forget), self-fencing via the epoch guard, fail-loud on a provider
   * error. The closing recap does NOT end the session — `end` follows later when
   * the client navigates away (the VoicePanel unmount sends `end`).
   */
  private async runClosingRecap(ws: Connection, outcome: RecapOutcome): Promise<void> {
    const myEpoch = this.turnEpoch
    try {
      if (!this.sessionState || !this.providers || this.sessionId === undefined) return
      traceTurn('turn', 'closing-start', { sessionId: this.sessionId })
      const providers = this.providers
      const state = this.sessionState
      await this.streamTurn(ws, (signal) =>
        runClosingTurn(providers, state, outcome, signal)[Symbol.asyncIterator]()
      )
    } catch (err: unknown) {
      // Skip the fail-loud close once a teardown has advanced the generation
      // (the session this recap belonged to is gone; a newer session may own
      // the socket now). Mirrors the opening-greeting error path exactly.
      if (this.turnEpoch === myEpoch) {
        const reason = err instanceof Error ? err.message : 'closing recap failed'
        traceTurnError('turn', 'closing-error', {
          sessionId: this.sessionId,
          messageChars: reason.length,
        })
        try {
          ws.close(1008, safeCloseReason(reason))
        } catch {
          // socket already gone — nothing to fail loud on.
        }
      }
    }
  }

  /**
   * Burn-through wind-down: the session's starburst budget elapsed while the WS
   * was resident (reward-economy L2 §5). Fired by the durable burn-through DO
   * alarm via {@link onBurnThroughAlarm} (hardening batch B FIX 1 — migrated off
   * the WS-resident `setTimeout`). Run ONE narrative wind-down turn (the
   * closing-recap path in the distinct `'depleted'` register — a warm farewell,
   * NOT a game outcome), then tear the session down: `endSession` deducts the
   * now-≈budget minutes + flushes usage + builds the summary, then clear and close
   * 1000 with a `summary` frame carrying `reason: 'balance-depleted'` so the panel
   * shows the depletion beat.
   *
   * Serial with any live turn (finding 1): if a turn is in flight when the alarm
   * fires, the wind-down is DEFERRED (`pendingWindDown`) until that turn drains,
   * so the recap never overlaps a live turn on the socket. The deferred turn is
   * itself bounded by the per-turn hard deadline (FIX 2), so even a STUCK turn
   * eventually releases the guard and lets this fire. The depletion outcome is
   * TERMINAL (findings 2 + 3): it deducts, clears every guard, and closes even if a
   * mid-farewell barge-in (`speech-start`) supersedes the recap — the teardown
   * aborts ONLY when a competing terminal path (`end` / owner close) already
   * unbound the session, keyed on the session identity, not the epoch (a barge-in
   * advances the epoch but leaves the session bound).
   *
   * The eviction edge (isolate evicted mid-session) is now covered DURABLY by the
   * alarm itself: {@link onBurnThroughAlarm} writes the depletion deduct from its
   * persisted payload when the session is no longer resident, so a depleted budget
   * is billed even when this resident recap path never runs.
   */
  private async windDown(ws: Connection): Promise<void> {
    this.burnScheduleId = undefined
    const sessionId = this.sessionId
    const userId = this.userId
    if (!this.sessionState || !this.providers || sessionId === undefined || userId === undefined) {
      return
    }
    // Serialize with an in-flight turn (finding 1): a reply / greeting / recap
    // streaming when the budget timer fires would otherwise overlap the wind-down
    // recap on the same socket — two concurrent `streamTurn`s clobbering the shared
    // `activeTurn`/`turnInFlight` guard and interleaving audio. Defer rather than
    // abruptly supersede the live turn: park the wind-down and let the running turn
    // finish. `streamTurn`'s `finally` re-invokes `windDown` the instant that turn
    // drains, so the recap runs strictly AFTER it and the two never overlap. (If a
    // barge-in supersedes the live turn instead, its stale `finally` is an
    // epoch-fenced no-op, but `pendingWindDown` survives on the still-bound session
    // and the next turn's `finally` — or a teardown that resets it — carries it, so
    // the wind-down is never lost or fired against a torn-down session.)
    if (this.turnInFlight) {
      this.pendingWindDown = ws
      return
    }
    const myEpoch = this.turnEpoch
    try {
      traceTurn('turn', 'winddown-start', { sessionId })
      const providers = this.providers
      const state = this.sessionState
      await this.streamTurn(ws, (signal) =>
        runClosingTurn(providers, state, 'depleted', signal)[Symbol.asyncIterator]()
      )
    } catch (err: unknown) {
      // A provider error during the wind-down recap: fail-loud-close like the
      // closing-recap path, epoch-fenced.
      if (this.turnEpoch === myEpoch) {
        const reason = err instanceof Error ? err.message : 'wind-down failed'
        traceTurnError('turn', 'winddown-error', {
          sessionId,
          messageChars: reason.length,
        })
        try {
          ws.close(1008, safeCloseReason(reason))
        } catch {
          // socket already gone — nothing to fail loud on.
        }
      }
      return
    }
    // Terminal-teardown guard (finding 3): the depletion OUTCOME must be terminal.
    // Abort ONLY when a competing TERMINAL path (a real `end` / owner-socket close)
    // already tore this session down — detected by the bound session being gone or
    // replaced (`clearSession` nulls `sessionId`; a reconnect binds a new one). A
    // mid-farewell barge-in (`speech-start`) ALSO advances the epoch but leaves the
    // session BOUND, so keying the abort on the epoch (as the prior code did)
    // wrongly abandoned the teardown — leaving the depleted session un-deducted and
    // un-closed. Keying on the session identity instead lets a barge-in still wind
    // down to a terminal close.
    if (this.sessionId !== sessionId) return
    // Tear down exactly as a normal `end` does (finding 2): `endSession` finalizes
    // accounting (deduct ≈ budget) + flushes usage + builds the summary + discards
    // any open utterance; CANCEL any turn a mid-farewell barge-in may have started
    // (the same fire-and-forget cancel the `end` path uses, so no provider stream
    // dangles); then `clearSession` clears the burn timer + resets the turn guards.
    // Hand off the capture, send the depletion summary, and close 1000.
    const summary = this.endSession(sessionId, userId)
    void this.cancelActiveTurn()
    this.clearSession()
    void handOffSummaryCapture(this.env.COMPANION_CONSOLIDATOR, summary)
    ws.send(JSON.stringify({ type: 'summary', summary, reason: 'balance-depleted' }))
    ws.close(1000, safeCloseReason('balance depleted'))
  }

  /**
   * The burn-through wind-down DO alarm's callback (hardening batch B FIX 1). The
   * Agents-SDK `schedule()` invokes this BY NAME when the budget alarm fires — a
   * durable dispatch that survives an isolate eviction (the schedule row + its
   * payload persist in the DO's SQLite storage). Two paths:
   *
   *  - RESIDENT (the normal case): the session is still bound, still THIS session
   *    (`sessionId` matches the payload), and the owner socket is live — run the
   *    full narrative {@link windDown} on it, identical UX to the pre-migration
   *    resident `setTimeout`.
   *  - NOT RESIDENT (the durability win): the isolate was evicted between `create`
   *    and the budget boundary, or the session already ended / a reconnect rebound
   *    the DO. The in-memory state the resident deduct reads is gone, so bill the
   *    depleted budget DURABLY from the persisted payload. Idempotent on
   *    `session:{sessionId}` — a no-op if the session already deducted at a normal
   *    teardown, so it never double-charges (fail-open, undercount-only). This is
   *    exactly the deduct the old WS-resident `setTimeout` LOST on eviction.
   *
   * PUBLIC (not `private`) for two reasons the SDK forces: `schedule()` types its
   * `callback` as `keyof this` resolved in the Agent base, which sees only public
   * members, and `noUnusedLocals` would flag a private method that is never
   * referenced by property access (the SDK dispatches it by string name). It is
   * not an attack surface — the DO is reachable only through the Worker's WS
   * upgrade + the hand-rolled control protocol, never as an arbitrary RPC method,
   * exactly like the already-public `createSession` / `endSession`.
   */
  async onBurnThroughAlarm(payload: BurnThroughPayload): Promise<void> {
    // Only act on the CURRENTLY BOUND session's own alarm. A DO is reused across
    // sessions; a stale alarm armed by an EARLIER session can fire after the DO was
    // rebound to a NEW session (its own cancel raced). It MUST NOT touch the new
    // session's `burnScheduleId` or state — clearing it here would strand the new
    // session's still-armed alarm (it could then no longer cancel it in
    // `clearSession`), and if that new session closed having delivered nothing (the
    // FIX 3 zero-bill path writes no `session:{id}` row) the stranded alarm would
    // later mis-bill the FULL budget from its durable payload.
    if (this.sessionId === payload.sessionId) {
      // This alarm belongs to the bound session: its one-shot schedule row just
      // fired, so drop the id (a later teardown must not cancel a spent schedule).
      this.burnScheduleId = undefined
      if (this.sessionState && this.ownerSocket !== undefined) {
        await this.windDown(this.ownerSocket)
        return
      }
      // Bound but no live socket (mid-teardown): fall through to the durable deduct
      // for THIS session — idempotent, so a competing teardown deduct is a no-op.
    }
    // Not the currently bound session (evicted / reconnected / stale earlier-session
    // alarm): bill ONLY the depleted budget for the alarm's OWN `payload.sessionId`,
    // never touching the current session's `burnScheduleId` or state.
    const db = this.env.COMPANION_DB
    if (db === undefined) return
    // Finding #2 — bill ONLY a session that actually delivered output. The durable
    // billable marker survives eviction (unlike in-memory `hasDeliveredTurn`); its
    // ABSENCE means a zero-delivery session — which FIX 3 bills ZERO and for which no
    // teardown `session:{id}` row exists, so the ON CONFLICT idempotency guard could
    // NOT stop a stale alarm from full-budget-billing it. Present => a
    // delivered-then-evicted (or delivered-then-raced-cancel) session that owes its
    // budget. The idempotency key remains the double-bill guard for the present case.
    const markerKey = `${BILLABLE_KEY_PREFIX}${payload.sessionId}`
    const billable = await this.ctx.storage
      .get<boolean>(markerKey)
      .catch(() => undefined as boolean | undefined)
    if (billable !== true) return // never delivered → bill nothing (fail-open on read error)
    await deductSessionMinutes(db, {
      userId: payload.userId,
      sessionId: payload.sessionId,
      minutes: payload.budgetMinutes,
      fundingSource: payload.fundingSource,
    }).catch((err: unknown) => {
      console.error(
        `platform-ai: burn-through alarm deduct failed for session:${payload.sessionId}`,
        err
      )
    })
    // The alarm has settled this session's bill (or no-op'd on an existing row); drop
    // the durable marker so it does not accumulate across the DO's lifetime.
    this.ctx.waitUntil(this.ctx.storage.delete(markerKey).catch(() => {}))
  }

  /**
   * Reject cross-session / cross-user access. Delegates to the pure
   * `assertSessionOwnership` predicate (the L2 ownership invariant — the `turn`
   * and `end` paths verify ownership against the bound session).
   */
  private assertOwner(sessionId: string, userId: string): void {
    assertSessionOwnership(this.boundIdentity(), sessionId, userId)
  }

  /**
   * Assert THIS socket's authenticated user owns the bound session, using the
   * shared ownership predicate. Drives the binary audio path so it carries the
   * same per-socket ownership guarantee as the control path. Throws (fail loud)
   * on a non-owner / unauthenticated / pre-create frame; the caller's listener
   * turns the throw into a 1008 close of this socket.
   */
  private assertSocketOwner(ws: Connection): void {
    assertSocketOwnsBoundSession(this.socketIdentities, ws, this.boundIdentity())
  }

  /**
   * The DO's bound identity in the `{ boundSessionId, boundUserId }` shape.
   * Both fields publish/clear together (`createSession` / `clearSession`), so
   * the pair is always fully bound or fully absent.
   */
  private boundIdentity(): { boundSessionId: string | undefined; boundUserId: string | undefined } {
    return {
      boundSessionId: this.sessionId,
      boundUserId: this.userId,
    }
  }

  /** WS control-message dispatch: create / speech-start / turn / end / update-gamestate. */
  private async handleControl(ws: Connection, msg: ControlMessage): Promise<void> {
    // The operating user is THIS socket's authenticated identity, resolved per
    // message — never a shared field a later upgrade could have overwritten.
    const socketUserId = this.socketIdentities.resolve(ws)
    switch (msg.type) {
      case 'create': {
        if (!socketUserId) {
          ws.close(1008, safeCloseReason('no authenticated identity'))
          return
        }
        // A session is already live on this DO. Re-`create` would silently
        // re-initialize `state`/`providers`/`userId` — blowing away an in-flight
        // turn's state and the bound owner. Reject (the session is active)
        // rather than reset. Fail-loud via an explicit signal on THIS socket so
        // a concurrently streaming turn on the same socket is not truncated (a
        // 1008 close would kill it); the owner's session is left intact.
        if (this.sessionState) {
          this.sendError(ws, 'already_created', 'session already created')
          return
        }
        // Companion-memory resolver call (assembly-time read path, L2
        // §Mechanism Variant 2). Best-effort and OUTSIDE the hot path: a
        // missing binding, no companion, or a resolver failure all degrade to
        // a memory-less session (the companion context is simply absent).
        const companionContext = await this.resolveCompanionContextBestEffort(
          socketUserId,
          msg.gameId,
          msg.streakDays
        )
        // Re-check the create guard AFTER the await above: a second `create`
        // could have interleaved across the resolver read. The check + the
        // synchronous `createSession` below are atomic again (no await
        // between them), preserving the publish-after-success property.
        if (this.sessionState) {
          this.sendError(ws, 'already_created', 'session already created')
          return
        }
        // Session pricing gate (reward-economy L2 §5). Best-effort welcome-mint +
        // balance read on the existing `COMPANION_DB` binding (a boundary read,
        // not a hot-path turn). A brand-new user is minted +10 before the read,
        // so a first-ever session opens; a below-minimum balance is refused with
        // a structured in-band frame + a clean 1000 close, and the session never
        // assembles. Dev/demo (no binding) or a D1 failure returns `Infinity`
        // (fail-open, a priceless session).
        const budget = await this.readSessionBudgetBestEffort(socketUserId)
        if (budget < MIN_SESSION_BALANCE) {
          this.sendError(ws, 'insufficient_balance', 'not enough starburst to open a session')
          ws.close(1000, safeCloseReason('insufficient balance'))
          return
        }
        // Re-apply the post-await already-created guard: the budget read is a
        // second await, so a concurrent `create` could have interleaved across it
        // — same discipline as the companion-context await above, keeping the
        // check + the synchronous `createSession` atomic.
        if (this.sessionState) {
          this.sendError(ws, 'already_created', 'session already created')
          return
        }
        // Bind the AUTH-validated user id, NOT any id the client claims. A finite
        // budget threads into `SessionState.budgetMinutes` (the deduct cap + the
        // burn-through basis); an `Infinity` dev/demo budget stays uncapped.
        const sessionId = this.createSession(
          msg.gameId,
          socketUserId,
          msg.manualData,
          msg.gameState,
          {
            ...(companionContext !== undefined ? { companionContext } : {}),
            ...(msg.gameRunId !== undefined ? { gameRunId: msg.gameRunId } : {}),
            ...(Number.isFinite(budget) ? { budgetMinutes: budget } : {}),
          }
        )
        // Record THIS socket as the session owner. Only this exact socket's close
        // tears the session down (`onSocketClose`); a same-user duplicate socket's
        // close must not. Set after a successful create so a rejected create
        // (`already_created`) never repoints the owner.
        this.ownerSocket = ws
        ws.send(JSON.stringify({ type: 'created', sessionId }))
        // Arm the burn-through wind-down DO alarm (L2 §5; FIX 1). Migrated off the
        // WS-resident `setTimeout` to the Agents-SDK durable `schedule()` — the DO
        // `alarm()` handler is RESERVED by the Agent base, so we drive a durable
        // schedule row (`onBurnThroughAlarm` at `budgetMinutes × burnSecondsPerMinute`
        // seconds) that survives an isolate eviction. The payload carries the
        // identity + budget so the depleted session is billed even on a fresh
        // post-eviction instance. Only for a finite, positive budget: a dev/demo
        // priceless session never depletes. Canceled on any earlier teardown
        // (`clearSession`). Still per-session wall-clock, still no per-minute writes.
        if (Number.isFinite(budget) && budget > 0) {
          const schedule = await this.schedule<BurnThroughPayload>(
            budget * this.burnSecondsPerMinute,
            'onBurnThroughAlarm',
            {
              sessionId,
              userId: socketUserId,
              budgetMinutes: budget,
              // v1 funding source is server-hardcoded 'earned' (SSOT:
              // `assembleSession` -> `SessionState.fundingSource`). The resident
              // wind-down reads the live `state.fundingSource`; only the durable
              // eviction-path deduct consumes this payload copy. A future phase that
              // varies funding updates both this literal and the assembly default.
              fundingSource: 'earned',
            }
          )
          // `schedule()` is a durable SQL write (an await), so a racing `end` / owner
          // close could have torn THIS session down while it armed. If the bound
          // session is no longer this one, cancel the orphan schedule so it never
          // fires against a dead / replaced session (the async-arming analog of the
          // create branch's post-await re-checks above).
          if (this.sessionId === sessionId) {
            this.burnScheduleId = schedule.id
          } else {
            void this.cancelSchedule(schedule.id).catch(() => {})
          }
        }
        // AI speaks first: fire the opening greeting (LLM->TTS, no player audio)
        // in the background, when enabled (default on — AI-first is the product
        // behaviour). `runOpeningGreeting` owns its own errors (fail-loud 1008 on
        // a provider error) and is epoch-fenced, so it is fire-and-forget; a
        // mid-greeting `end`/owner close cancels it through the same
        // `activeTurn`/`turnEpoch` machinery as a client turn.
        if (msg.opening ?? true) void this.runOpeningGreeting(ws)
        return
      }
      case 'speech-start': {
        // The player began an utterance: OPEN a live recognizer and start feeding
        // audio. A DRIVE op (owner-USER grain, same as binary audio): the
        // operating socket's authenticated user must own the bound session. A
        // non-owner / unauthenticated / pre-create signal throws -> the listener
        // fail-louds with 1008, exactly as the binary-audio gate does. (The mic
        // only opens on `created`, so a pre-create signal is defense-in-depth.)
        this.assertSocketOwner(ws)
        this.beginUtterance(ws)
        return
      }
      case 'turn': {
        const sessionId = this.sessionId
        if (!this.sessionState || !socketUserId || sessionId === undefined || !this.providers) {
          ws.close(1008, safeCloseReason('turn before create'))
          return
        }
        // Cross-user / cross-session turn -> fail loud (1008 via the listener).
        // Preserves the prior `onAiResponse` ownership assertion (DRIVE op, owner-
        // USER grain), so a second authenticated user on this DO cannot finalize
        // the owner's utterance.
        this.assertOwner(sessionId, socketUserId)
        // Turn in-flight guard: voice turns are serial. A second `turn` while a
        // reply is running (owner double-click / retry) would start a second reply
        // over the shared `state`/`providers` and interleave two response streams
        // on this one socket — DO events interleave across the reply's LLM/TTS
        // `await`s. Reject the overlap with an explicit signal on THIS socket (NOT
        // a 1008 close — the first reply is streaming on the same socket and a
        // close would truncate it). The live reply is untouched.
        if (this.turnInFlight) {
          this.sendError(ws, 'turn_in_flight', 'a turn is already in progress')
          return
        }
        const utterance = this.liveUtterance
        if (utterance === undefined) {
          // A `turn` with no open utterance: no prior `speech-start`, or it was
          // already finalized / barged-in away. Benign no-op — nothing to
          // finalize, no reply (the player effectively said nothing this turn).
          return
        }
        // Finalize THIS utterance: detach it so a stray later `turn` is benign,
        // then close its bridge so the ASR pump sends the negative-sequence
        // end-of-audio packet and 火山 returns the last-package final.
        this.liveUtterance = undefined
        const myEpoch = this.turnEpoch
        utterance.bridge.close()
        // Turn-trace: the finalize boundary — the utterance is closing and the
        // reply is about to drive LLM->TTS. Greppable park-point anchor.
        traceTurn('turn', 'start', { sessionId })
        // Await the live STT finalization (it drains on the bridge close above).
        await utterance.done
        // A barge-in / teardown during the finalize await advanced the generation:
        // abandon this reply (a newer utterance owns the floor, or the session is
        // gone). Also re-check the session is still bound (teardown nulls it).
        if (this.turnEpoch !== myEpoch || !this.sessionState || !this.providers) return
        if (utterance.error !== undefined) {
          // A genuine ASR fault already fail-loud-closed the socket in
          // `beginUtterance` (epoch-fenced) — nothing more to do here.
          return
        }
        const result: UtteranceResult = utterance.outcome ?? { transcript: '', audioBytes: 0 }
        // Run the reply (terminal transcript frame + LLM+TTS over the complete
        // utterance) under the serial-turn guard. A no-speech utterance (empty
        // transcript) is skipped inside `runReply` — no chunks, no state, benign.
        // `streamTurn` owns the `turnInFlight`/`activeTurn`/`turnEpoch` machinery
        // (see its docstring), so a mid-reply `end`/owner close cancels cleanly and
        // a stale `finally` cannot clobber a newer session's guard.
        const providers = this.providers
        const state = this.sessionState
        await this.streamTurn(ws, (signal) =>
          runReply(providers, state, result, signal)[Symbol.asyncIterator]()
        )
        return
      }
      case 'text-turn': {
        // The text fallback (FP1 A): typed input bypasses STT. Same gates as a
        // voice `turn` (owner + live session), the same serial in-flight guard,
        // and the same reply path — only the transcript source differs (the
        // typed text, not ASR). Additive: it neither requires nor disturbs the
        // live-utterance / ASR path, so it works with no prior `speech-start`.
        const sessionId = this.sessionId
        if (!this.sessionState || !socketUserId || sessionId === undefined || !this.providers) {
          ws.close(1008, safeCloseReason('text-turn before create'))
          return
        }
        this.assertOwner(sessionId, socketUserId)
        if (this.turnInFlight) {
          this.sendError(ws, 'turn_in_flight', 'a turn is already in progress')
          return
        }
        // Truncate defensively: never trust the client's length cap.
        const text =
          typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_TEXT_TURN_CHARS) : ''
        if (text.length === 0) {
          // Empty/whitespace typed input: benign no-op (the typed analog of a
          // no-speech turn) — no reply, no state, no turn counted.
          return
        }
        traceTurn('turn', 'text-start', { sessionId })
        // Feed the typed text as the turn's transcript directly (audioBytes: 0,
        // so STT usage is zero), reusing the voice reply path wholesale.
        const providers = this.providers
        const state = this.sessionState
        await this.streamTurn(ws, (signal) =>
          runReply(providers, state, { transcript: text, audioBytes: 0 }, signal)[
            Symbol.asyncIterator
          ]()
        )
        return
      }
      case 'end': {
        const sessionId = this.sessionId
        if (this.sessionState && socketUserId && sessionId !== undefined) {
          // Owner-socket gate on the teardown side (F-W self-consistency): `end`
          // is the other path — besides owner-close — that `clearSession()`s the
          // bound session. `endSession`'s `assertOwner` only checks the USER id,
          // so a SAME-user duplicate socket (a second tab / reconnect) would pass
          // it and tear down the still-active original session. Gate teardown on
          // the owner SOCKET reference (mirroring `onSocketClose`): a non-owner
          // socket's `end` — even same user — is rejected fail-loud (1008 close of
          // THAT socket, consistent with the cross-user `assertOwner` throw path)
          // and never reaches teardown, so the owner's session/turn survive.
          // (`turn` and binary stay user-id-gated: they DRIVE the session, they do
          // not tear it down — see `assertOwner` / `assertSocketOwner`.)
          if (!socketIsBoundSessionOwner(ws, this.ownerSocket, this.boundIdentity())) {
            ws.close(1008, safeCloseReason('end from non-owner socket'))
            return
          }
          // `endSession` re-validates ownership (a cross-user `end` throws before
          // any teardown — the throw closes THAT socket with 1008 via the
          // listener, so a non-owner cannot end / cancel the owner's turn),
          // terminates any open live utterance's recognizer (`discardLiveUtterance`
          // closes its bridge so its STT stream ends; a reply in flight already
          // detached + closed its own utterance bridge at `turn` finalize),
          // flushes the session's usage to the USAGE KV (exactly once — the flush
          // boundary lives in the teardown method,
          // not in this branch; see `endSession` / `flushUsage`), and returns
          // the summary.
          const summary = this.endSession(sessionId, socketUserId)
          // Cancel the in-flight turn FIRE-AND-FORGET, then summarize + close
          // immediately — do NOT await the cancel. `AsyncIterator.return()` cannot
          // interrupt a provider `await` already pending inside the generator (an
          // STT/LLM/TTS promise that is slow or stuck): the generator only reaches
          // its `finally` once that promise settles. Awaiting the cancel here would
          // make `end` hang for as long as the provider is stuck — leaving the
          // owner unable to end the session and the socket open. So we initiate the
          // best-effort cancel (`return()` + bridge close already done by
          // `endSession`) and proceed without blocking on it. The background cancel
          // still completes when the provider promise eventually settles: at that
          // point `runTurn`'s `finally` closes the sentence queue + returns the live
          // LLM/TTS iterators (no stream leaks). The in-flight guard itself is
          // released synchronously by the `clearSession` below (which resets
          // `turnInFlight`/`activeTurn` for this ended generation); the late turn
          // loop `finally` is then EPOCH-FENCED — `clearSession` bumped the epoch,
          // so the stale `finally` finds `turnEpoch !== myEpoch` and is a no-op,
          // never touching a session that may have already been re-`create`d on
          // this resident DO (the cross-generation race this fix closes; see
          // `turnEpoch` + `clearSession`). A turn canceled mid-flight never reaches
          // `runTurn`'s settle step, so it never increments `turnCount` — the
          // summary counts only fully-completed turns.
          // Truly abortable cancellation (an AbortSignal threaded through `runTurn`
          // into each adapter to interrupt a stuck fetch/WS) is a separate followup,
          // not this fix.
          void this.cancelActiveTurn()
          // Clear the bound session state so the ended session leaves no residue
          // on this resident DO. MUST follow the cancel: `cancelActiveTurn`
          // captures the live `activeTurn` synchronously above, so clearing the
          // field now does not strand the in-flight turn's cleanup. After this,
          // a later same-name reconnect's `create` opens a clean new session
          // (no false `already_created`) and a `turn` without a fresh `create`
          // is rejected ("turn before create") instead of running a provider
          // turn on the just-ended session. See `clearSession`.
          this.clearSession()
          // Companion-memory capture hand-off (L2 capture entry): deliver the
          // finished summary to the consolidator DO, fire-and-forget. Both
          // the helper (never throws) and the placement (after teardown is
          // fully settled, before the close) keep the invariant "a capture
          // failure must never affect the game result or the session end".
          void handOffSummaryCapture(this.env.COMPANION_CONSOLIDATOR, summary)
          ws.send(JSON.stringify({ type: 'summary', summary }))
        }
        ws.close(1000, safeCloseReason('session ended'))
        return
      }
      case 'closing': {
        // Closing-recap trigger: run one final LLM+TTS turn (the post-win
        // recap) and stream it back. Must have a live session + the owner
        // socket; a non-owner or pre-create signal is a silent no-op (NOT a
        // 1008 close — the session remains alive; `end` follows when the client
        // navigates away). A turn in flight is rejected with `turn_in_flight` so
        // the serial-turn guard is not violated; the client falls back to its
        // hard timeout and navigates without waiting for the recap.
        if (
          !this.sessionState ||
          !socketUserId ||
          this.sessionId === undefined ||
          !this.providers
        ) {
          return
        }
        if (!socketIsBoundSessionOwner(ws, this.ownerSocket, this.boundIdentity())) {
          return
        }
        if (this.turnInFlight) {
          this.sendError(ws, 'turn_in_flight', 'a turn is already in progress')
          return
        }
        // Absent outcome defaults to `defused` (wire back-compat with the
        // pre-outcome client that sent a bare `{type:'closing'}`).
        void this.runClosingRecap(ws, msg.outcome ?? 'defused')
        return
      }
      case 'update-gamestate': {
        // Steer the live session's manual injection for SUBSEQUENT turns. This
        // is fire-and-forget session metadata: it adjusts which manual subset
        // the next turn injects, and must NEVER tear down or interrupt the
        // running conversation (the whole point of one continuous session across
        // modules is that history + the AI-first greeting persist). So every
        // rejection path here is a benign no-op, NOT a 1008 close: no live
        // session, a non-owner socket, or a malformed payload all just return
        // without mutating anything.
        //
        // Owner-socket gated, mirroring `end`'s teardown gate (only the creator
        // socket may steer its own session — a same-user duplicate tab / a
        // second authenticated socket on this DO must not redirect the owner's
        // injected manual). The non-owner consequence is downgraded from `end`'s
        // 1008 close to a silent no-op: this message only re-selects sections,
        // so ignoring a stray one is strictly safer than killing a socket.
        if (!this.sessionState) return
        if (!socketIsBoundSessionOwner(ws, this.ownerSocket, this.boundIdentity())) return
        // Validate the untrusted payload defensively (the `JSON.parse` cast is
        // unchecked): a missing `gameState`, a non-array `relevantSections`, or a
        // non-string element is a benign no-op rather than a throw — a throw would
        // be caught by `onMessage` and 1008-close the owner's socket, losing the
        // whole conversation.
        let incoming: GameState
        try {
          incoming = normalizeVoiceGameState(this.sessionState.config.gameId, msg.gameState)
        } catch {
          return
        }
        // Reassign the FIELD (not the whole `sessionState` object) so history,
        // turnCount, usage, and any in-flight turn's already-captured `messages`
        // are untouched; only `assembleSystem`'s NEXT read (at the next turn's
        // start) picks up the new sections. Copy the array so a later client-side
        // mutation of the payload can never reach into session state. An in-flight
        // turn snapshotted its `messages` at its own start, so this update applies
        // strictly to the next turn — the running turn is never disturbed.
        this.sessionState.gameState = incoming
        return
      }
    }
  }
}
