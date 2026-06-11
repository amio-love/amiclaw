/**
 * `VoiceSessionDO` — the Durable Object that carries one voice session.
 *
 * It is a thin shell over the testable orchestration in `turn-pipeline.ts`:
 *   - It holds the session state (gameId/userId binding, conversation history,
 *     game state, usage counters) created in `createSession`.
 *   - It implements the four-method contract semantics
 *     (`createSession` / `onPlayerAudio` / `onAiResponse` / `endSession`),
 *     enforcing `sessionId <-> userId` ownership on every operation.
 *   - It drives `runTurn` over the WebSocket: inbound binary frames are player
 *     audio; outbound `AiResponseChunk`s are serialized back to the player.
 *
 * The orchestration logic itself lives in `runTurn` (pure, provider-mocked
 * unit tests); this class is the DO/WS adapter around it.
 *
 * Hibernation is deliberately NOT used. The DO sets `binaryType = 'arraybuffer'`
 * then accepts the socket with a plain `server.accept()` and listens via
 * `addEventListener('message'|'close')`, so it stays resident for the session's
 * lifetime, binary audio frames arrive as `ArrayBuffer` (not the post-2026
 * `Blob` default), and the in-memory session state
 * (`state` / `providers`) is always valid between `create` and a later `turn`.
 * The WebSocket Hibernation API (`ctx.acceptWebSocket` + the `webSocketMessage`
 * rehydration callback) would drop that in-memory state on an idle-eviction
 * between turns — rejecting the next message as "turn before create" and losing
 * history. Turn-based voice sessions have short idle windows, so the hibernation
 * cost saving does not justify persisting + rehydrating session state per
 * message (L2 §Open Questions — "WebSocket Hibernation 是否启用"). API verified
 * against `@cloudflare/workers-types` 4.20260608.1 (`DurableObject` base from
 * `cloudflare:workers`; `WebSocket.accept` / `addEventListener`).
 *
 * The authenticated user id forwarded by the Worker is bound PER ACCEPTED SOCKET
 * (via `SocketIdentityRegistry`), not in a shared instance field: two
 * already-authenticated clients can connect to the same-named DO (one instance),
 * and a shared field would let the later upgrade overwrite the earlier client's
 * identity — letting socket B drive `create`/`reset` under socket A's user. Both
 * inbound paths resolve the id of the exact socket a frame arrived on and verify
 * it owns the bound session: control messages (create/turn/end) and binary audio
 * frames alike. The binary path must gate too — otherwise a second authenticated
 * socket on the same DO could push audio onto the owner's shared bridge, which
 * the owner's next `turn` would transcribe (forging the owner's utterance). So
 * the per-operation ownership invariant (L2 §Mechanism Variant 3) holds per
 * socket across every inbound frame, not just control messages.
 *
 * Two ownership grains coexist, split by what the operation does:
 *  - DRIVE operations (`turn`, binary audio) are gated on the owner USER id: the
 *    operating socket's authenticated user must equal the bound owner. They run a
 *    turn / feed audio; they never clear the session.
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

import { DurableObject } from 'cloudflare:workers'
import type { AiResponseChunk, AudioChunk, ManualData, SessionSummary } from './contract'
import type { GameState } from './manual-injection'
import type { ProviderEnv } from './providers/factory'
import { assembleSession } from './session-assembly'
import { runTurn, type SessionState, type TurnProviders } from './turn-pipeline'
import { flushSessionUsage, type UsageKvWriter } from './usage-flush'
import {
  assertSessionOwnership,
  assertSocketOwnsBoundSession,
  socketIsBoundSessionOwner,
  SocketIdentityRegistry,
} from './auth-seam'

/**
 * Env bindings visible to the DO: provider creds, the AUTH KV (unused here),
 * and the optional USAGE KV the session-terminal metering flush writes to.
 * `USAGE` is optional by design — a dev/demo deploy without the binding skips
 * the flush fail-open (see `usage-flush.ts`).
 */
export type SessionDoEnv = ProviderEnv & { USAGE?: UsageKvWriter } & Record<string, unknown>

/** The DO accepts a single session-control message kind plus binary audio. */
interface CreateSessionMessage {
  type: 'create'
  gameId: string
  manualData: ManualData
  gameState?: GameState
}

/**
 * Run one turn: close the current audio bridge so STT terminates, drive
 * `runTurn`, and stream the resulting `AiResponseChunk`s back to the client.
 * The player pushes binary audio frames, then sends this control message to
 * signal "that's my utterance, respond now".
 */
interface TurnMessage {
  type: 'turn'
}

interface EndSessionMessage {
  type: 'end'
}

type ControlMessage = CreateSessionMessage | TurnMessage | EndSessionMessage

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
 * Async audio bridge: binary WS frames are pushed in; `runTurn`'s STT step
 * pulls them via `for await`. One bridge backs one in-flight turn; `end` closes
 * it so the STT stream terminates.
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

export class VoiceSessionDO extends DurableObject<SessionDoEnv> {
  /** Session state, set on `create`; `undefined` until then. */
  private state: SessionState | undefined
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
  /** Wired providers for the session. */
  private providers: TurnProviders | undefined
  /** Audio bridge for the in-flight turn, if any. */
  private audio: AudioBridge | undefined
  /**
   * Turn in-flight guard. A voice turn is a single serial round; a DO event can
   * interleave across the many `await`s inside one turn (STT/LLM/TTS all await),
   * so a second `turn` message arriving mid-flight would start a second
   * `onAiResponse`/`runTurn` over the SAME `state`/`providers`/socket — racing
   * the shared `history`/`usage` and interleaving two response streams on one
   * socket. This flag is `true` for exactly the window one turn is running; a
   * second `turn` while set is rejected (fail-loud), and it is cleared in the
   * turn loop's `finally` so success / failure / cancel all release it (an
   * exception can never wedge the guard shut).
   */
  private turnInFlight = false
  /**
   * The in-flight turn's async iterator, held so a mid-turn `end` (or the
   * owner's socket close) can cancel it cleanly: closing the audio bridge
   * terminates STT, and `return()` on this iterator runs `runTurn`'s `finally`
   * (closes the sentence queue, returns the live LLM/TTS iterators) so no
   * provider stream is left dangling. `undefined` when no turn is running.
   */
  private activeTurn: AsyncIterator<AiResponseChunk> | undefined
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
  private readonly socketIdentities = new SocketIdentityRegistry<WebSocket>()
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
  private ownerSocket: WebSocket | undefined

  /**
   * WS upgrade entry. The Worker forwards the (already auth-validated) upgrade
   * request here, carrying the resolved user id in `X-Session-User-Id`. We bind
   * that id to THIS accepted socket (so a second client on the same DO cannot
   * overwrite it), accept the server side with a plain `accept()` (no
   * hibernation — see the file header), wire its message/close listeners, and
   * hand the client side back in the 101 response.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 })
    }
    const forwardedUserId = request.headers.get('X-Session-User-Id')
    if (!forwardedUserId) {
      return new Response('missing authenticated identity', { status: 401 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // Opt this socket back into ArrayBuffer delivery for binary frames BEFORE
    // accepting it. With this Worker's `compatibility_date` (2026-06-08) the
    // `websocket_standard_binary_type` default delivers binary WS messages as
    // `Blob`, but `onSocketMessage` consumes player audio frames synchronously
    // as `ArrayBuffer` (`new Uint8Array(data)`). A `Blob` would slip past the
    // `typeof data === 'string'` branch and be wrapped into an empty/garbage
    // `Uint8Array`, corrupting every audio frame. Setting `binaryType` keeps the
    // existing synchronous, ArrayBuffer-typed handler correct. MUST precede
    // `accept()` — the runtime only honors it before the socket is accepted.
    // (Cloudflare docs: runtime-apis/websockets#binary-messages.)
    server.binaryType = 'arraybuffer'
    // Plain accept keeps the DO resident for the session (no hibernation), so
    // the in-memory session state survives between turns.
    server.accept()
    // Bind the authenticated identity to this specific socket.
    this.socketIdentities.bind(server, forwardedUserId)

    server.addEventListener('message', (event) => {
      this.onSocketMessage(server, event.data as string | ArrayBuffer).catch((err: unknown) => {
        // Fail loud: an ownership violation or a malformed control message ends
        // this socket with a policy-violation close rather than leaking an
        // unhandled rejection. Other sockets on the DO are unaffected.
        const reason = err instanceof Error ? err.message : 'message handling failed'
        server.close(1008, reason.slice(0, 123))
      })
    })
    server.addEventListener('close', () => {
      this.onSocketClose(server)
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  /** Inbound WS frame: a JSON control message (string) or an audio frame (binary). */
  private async onSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data === 'string') {
      await this.handleControl(ws, JSON.parse(data) as ControlMessage)
      return
    }
    // Binary frame: player audio. Gate it through the SAME per-socket ownership
    // predicate the control path uses — a binary frame must come from the socket
    // whose user owns the bound session. Without this, a second authenticated
    // socket on the same DO could push frames the owner's next `turn` transcribes,
    // forging the owner's utterance. The throw on a non-owner frame propagates to
    // the message listener's `.catch`, which closes THAT socket with 1008 (fail
    // loud, control-path-consistent) — the owner's bridge is never touched.
    this.assertSocketOwner(ws)
    const bridge = this.ensureAudioBridge()
    bridge.push(new Uint8Array(data))
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
  private onSocketClose(ws: WebSocket): void {
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
   * the DO bound to a user with NO `state`/`providers`: that user's binary
   * frames then passed the ownership gate, lazily created an audio bridge, and
   * the leaked pre-create frames survived into the next SUCCESSFUL session's
   * first turn (create does not reset `this.audio`).
   */
  createSession(
    gameId: string,
    userId: string,
    manualData: ManualData,
    gameState?: GameState
  ): string {
    const assembled = assembleSession(gameId, userId, manualData, gameState, this.env)
    // Atomic publish — nothing below this line can throw or await.
    this.sessionId = assembled.sessionId
    this.userId = assembled.userId
    this.providers = assembled.providers
    this.state = assembled.state
    this.usageFlushed = false
    return assembled.sessionId
  }

  /**
   * Feed one player audio frame. Validates `sessionId <-> userId` ownership,
   * then pushes the frame onto the in-flight turn's audio bridge.
   */
  onPlayerAudio(sessionId: string, userId: string, audioChunk: AudioChunk): void {
    this.assertOwner(sessionId, userId)
    this.ensureAudioBridge().push(audioChunk)
  }

  /**
   * Run a turn over the current audio and yield the AI response stream.
   * Validates ownership, then delegates to `runTurn`. The caller is expected to
   * have finished pushing the turn's audio (or to close the bridge) so STT can
   * terminate.
   */
  async *onAiResponse(sessionId: string, userId: string): AsyncIterable<AiResponseChunk> {
    this.assertOwner(sessionId, userId)
    if (!this.state || !this.providers) {
      throw new Error('session-do: onAiResponse before createSession')
    }
    const bridge = this.ensureAudioBridge()
    bridge.close()
    this.audio = undefined
    yield* runTurn(this.providers, this.state, bridge)
  }

  /**
   * End the session: validate ownership, settle, flush the session's usage to
   * the USAGE KV, and return the summary with the turn count and usage mount
   * point.
   *
   * The flush lives HERE — in the contract method — because `endSession` is
   * the single implementation boundary every `end`-shaped termination goes
   * through: the WS `end` branch calls this method, and a direct consumer
   * driving the four-method contract over the DO stub reaches it without any
   * WS framing. Hanging the flush on the WS branch instead would let a direct
   * contract call end a session unmetered. The owner-socket close path keeps
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
    if (!this.state) {
      throw new Error('session-do: endSession before createSession')
    }
    this.audio?.close()
    this.audio = undefined
    const summary: SessionSummary = {
      sessionId,
      gameId: this.state.config.gameId,
      userId,
      turnCount: this.state.turnCount,
      usage: { ...this.state.usage },
    }
    this.flushUsage()
    return summary
  }

  // --- Internals ---

  private ensureAudioBridge(): AudioBridge {
    if (this.audio === undefined) this.audio = new AudioBridge()
    return this.audio
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
    this.state = undefined
    this.userId = undefined
    this.sessionId = undefined
    this.providers = undefined
    this.audio = undefined
    this.turnInFlight = false
    this.activeTurn = undefined
    this.ownerSocket = undefined
    this.usageFlushed = false
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
    const state = this.state
    const sessionId = this.sessionId
    const userId = this.userId
    if (!state || sessionId === undefined || userId === undefined) return
    if (this.usageFlushed) return
    this.usageFlushed = true
    this.ctx.waitUntil(
      flushSessionUsage(this.env.USAGE, {
        sessionId,
        userId,
        gameId: state.config.gameId,
        turnCount: state.turnCount,
        usage: { ...state.usage },
        sttSource: state.sttSource,
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
  private sendError(ws: WebSocket, code: string, message: string): void {
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
   * Reject cross-session / cross-user access. Delegates to the pure
   * `assertSessionOwnership` predicate (the L2 ownership invariant —
   * `onPlayerAudio` / `onAiResponse` / `endSession` verify ownership).
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
  private assertSocketOwner(ws: WebSocket): void {
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

  /** WS control-message dispatch driving the four-method semantics. */
  private async handleControl(ws: WebSocket, msg: ControlMessage): Promise<void> {
    // The operating user is THIS socket's authenticated identity, resolved per
    // message — never a shared field a later upgrade could have overwritten.
    const socketUserId = this.socketIdentities.resolve(ws)
    switch (msg.type) {
      case 'create': {
        if (!socketUserId) {
          ws.close(1008, 'no authenticated identity')
          return
        }
        // A session is already live on this DO. Re-`create` would silently
        // re-initialize `state`/`providers`/`userId` — blowing away an in-flight
        // turn's state and the bound owner. Reject (the session is active)
        // rather than reset. Fail-loud via an explicit signal on THIS socket so
        // a concurrently streaming turn on the same socket is not truncated (a
        // 1008 close would kill it); the owner's session is left intact.
        if (this.state) {
          this.sendError(ws, 'already_created', 'session already created')
          return
        }
        // Bind the AUTH-validated user id, NOT any id the client claims.
        const sessionId = this.createSession(
          msg.gameId,
          socketUserId,
          msg.manualData,
          msg.gameState
        )
        // Record THIS socket as the session owner. Only this exact socket's close
        // tears the session down (`onSocketClose`); a same-user duplicate socket's
        // close must not. Set after a successful create so a rejected create
        // (`already_created`) never repoints the owner.
        this.ownerSocket = ws
        ws.send(JSON.stringify({ type: 'created', sessionId }))
        return
      }
      case 'turn': {
        const sessionId = this.sessionId
        if (!this.state || !socketUserId || sessionId === undefined) {
          ws.close(1008, 'turn before create')
          return
        }
        // Turn in-flight guard: voice turns are serial. A second `turn` while
        // one is running (owner double-click / retry) would start a second
        // `runTurn` over the shared `state`/`providers` and interleave two
        // response streams on this one socket — DO events interleave across the
        // turn's STT/LLM/TTS `await`s. Reject the overlap with an explicit
        // signal on THIS socket (NOT a 1008 close — the first turn is streaming
        // on the same socket and a close would truncate it). No second
        // `onAiResponse`/`runTurn` is started; the live turn is untouched.
        if (this.turnInFlight) {
          this.sendError(ws, 'turn_in_flight', 'a turn is already in progress')
          return
        }
        // Stream the AI response chunks back. Text rides as JSON; audio is
        // base64-encoded so the whole turn stays on the JSON text channel and
        // the binary frame direction remains player-audio-only. Ownership is
        // checked against THIS socket's user, so a second client on the same DO
        // cannot drive the first user's session.
        //
        // Hold the iterator explicitly so a mid-turn `end` / owner close can
        // cancel it via `return()`. Mark in-flight BEFORE the first `await`
        // (synchronous up to here) so an interleaved second `turn` sees the
        // guard set. Capture THIS turn's generation (`myEpoch`) at the same
        // synchronous point the shared fields are set, so the `finally` can tell
        // "still my session" from "a newer session reused this DO after my
        // session was torn down". The `finally` clears the guard + iterator on
        // every exit (normal end, provider error, or cancellation) so the next
        // turn can run — but ONLY while this turn is still the live generation
        // (see `turnEpoch`): a stale `finally` whose session was already ended/
        // dropped must not null out a newer session's `turnInFlight`/`activeTurn`.
        const turn = this.onAiResponse(sessionId, socketUserId)[Symbol.asyncIterator]()
        const myEpoch = this.turnEpoch
        this.activeTurn = turn
        this.turnInFlight = true
        try {
          for (;;) {
            const next = await turn.next()
            if (next.done) break
            const chunk = next.value
            if (chunk.kind === 'audio' && chunk.audio) {
              ws.send(
                JSON.stringify({
                  type: 'chunk',
                  kind: 'audio',
                  audio: base64FromBytes(chunk.audio),
                  done: chunk.done,
                })
              )
            } else {
              ws.send(
                JSON.stringify({
                  type: 'chunk',
                  kind: 'text',
                  text: chunk.text ?? '',
                  done: chunk.done,
                })
              )
            }
          }
        } finally {
          // Epoch guard: only release the guard + iterator if THIS turn is still
          // the live generation. If `clearSession` (end / owner-close) already
          // bumped the epoch and a newer session is running on this resident DO,
          // `this.turnEpoch !== myEpoch` and we leave the new session's
          // `turnInFlight`/`activeTurn` untouched — the stale `finally` is a
          // no-op. In the normal single-session path the epoch is unchanged, so
          // this clears exactly as before.
          if (this.turnEpoch === myEpoch) {
            this.turnInFlight = false
            this.activeTurn = undefined
          }
        }
        return
      }
      case 'end': {
        const sessionId = this.sessionId
        if (this.state && socketUserId && sessionId !== undefined) {
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
            ws.close(1008, 'end from non-owner socket')
            return
          }
          // `endSession` re-validates ownership (a cross-user `end` throws before
          // any teardown — the throw closes THAT socket with 1008 via the
          // listener, so a non-owner cannot end / cancel the owner's turn),
          // closes the audio bridge (the NEXT turn's bridge, which buffered any
          // frames that arrived during this turn — the in-flight turn already
          // detached + closed its own bridge at `onAiResponse` start, so its STT
          // has already terminated), flushes the session's usage to the USAGE
          // KV (exactly once — the flush boundary lives in the contract method,
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
          ws.send(JSON.stringify({ type: 'summary', summary }))
        }
        ws.close(1000, 'session ended')
        return
      }
    }
  }
}
