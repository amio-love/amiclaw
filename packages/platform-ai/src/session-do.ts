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
 * unit tests); this class is the DO/WS adapter around it. WebSocket Hibernation
 * is used so an idle session does not pin a live isolate: `ctx.acceptWebSocket`
 * registers the socket and `webSocketMessage` / `webSocketClose` are the
 * rehydration callbacks. API verified against `@cloudflare/workers-types`
 * 4.20260608.1 (`DurableObject` base from `cloudflare:workers`;
 * `DurableObjectState.acceptWebSocket` / `getWebSockets`).
 */

import { DurableObject } from 'cloudflare:workers'
import type { AiResponseChunk, AudioChunk, ManualData, SessionSummary } from './contract'
import type { GameState } from './manual-injection'
import { resolveConfig } from './provider-config'
import { createProviders, type ProviderEnv } from './providers/factory'
import { runTurn, type SessionState, type TurnProviders } from './turn-pipeline'
import { assertSessionOwnership } from './auth-seam'

/** Env bindings visible to the DO (provider creds + the AUTH KV, unused here). */
export type SessionDoEnv = ProviderEnv & Record<string, unknown>

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
  /** Wired providers for the session. */
  private providers: TurnProviders | undefined
  /** Audio bridge for the in-flight turn, if any. */
  private audio: AudioBridge | undefined
  /**
   * Authenticated user id forwarded by the Worker from the validated handshake
   * (`X-Session-User-Id`). This is the authoritative identity bound at
   * `createSession` — the client-supplied control message is NOT trusted for it.
   */
  private authUserId: string | undefined

  /**
   * WS upgrade entry. The Worker forwards the (already auth-validated) upgrade
   * request here, carrying the resolved user id in `X-Session-User-Id`. We
   * capture that id as the authoritative session identity, accept the client
   * side via Hibernation, and hand the server side back in the 101 response.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 })
    }
    const forwardedUserId = request.headers.get('X-Session-User-Id')
    if (!forwardedUserId) {
      return new Response('missing authenticated identity', { status: 401 })
    }
    this.authUserId = forwardedUserId
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Inbound WS frame: a JSON control message (string) or an audio frame (binary). */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string') {
      await this.handleControl(ws, JSON.parse(message) as ControlMessage)
      return
    }
    // Binary frame: player audio for the in-flight (or next) turn.
    const bridge = this.ensureAudioBridge()
    bridge.push(new Uint8Array(message))
  }

  /** Socket closed: tear the in-flight turn's audio stream down. */
  override async webSocketClose(): Promise<void> {
    this.audio?.close()
    this.audio = undefined
  }

  // --- Four-method contract semantics ---

  /**
   * Create the session: bind the (already-authenticated) `userId`, resolve the
   * game's provider/prompt config, wire the providers, and initialize state.
   * Returns the DO id string as the opaque `SessionId`.
   */
  createSession(
    gameId: string,
    userId: string,
    manualData: ManualData,
    gameState?: GameState
  ): string {
    const config = resolveConfig(gameId)
    this.userId = userId
    this.providers = createProviders(config, this.env)
    this.state = {
      config,
      manualData,
      gameState: gameState ?? { relevantSections: [] },
      history: [],
      turnCount: 0,
      usage: { llmInputTokens: 0, llmOutputTokens: 0, sttInputSeconds: 0, ttsOutputSeconds: 0 },
    }
    return this.ctx.id.toString()
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
   * End the session: validate ownership, settle, and return the summary with
   * the turn count and usage mount point.
   */
  endSession(sessionId: string, userId: string): SessionSummary {
    this.assertOwner(sessionId, userId)
    if (!this.state) {
      throw new Error('session-do: endSession before createSession')
    }
    this.audio?.close()
    this.audio = undefined
    return {
      sessionId,
      gameId: this.state.config.gameId,
      userId,
      turnCount: this.state.turnCount,
      usage: { ...this.state.usage },
    }
  }

  // --- Internals ---

  private ensureAudioBridge(): AudioBridge {
    if (this.audio === undefined) this.audio = new AudioBridge()
    return this.audio
  }

  /**
   * Reject cross-session / cross-user access. Delegates to the pure
   * `assertSessionOwnership` predicate (the L2 ownership invariant —
   * `onPlayerAudio` / `onAiResponse` / `endSession` verify ownership).
   */
  private assertOwner(sessionId: string, userId: string): void {
    assertSessionOwnership(
      {
        boundSessionId: this.userId === undefined ? undefined : this.ctx.id.toString(),
        boundUserId: this.userId,
      },
      sessionId,
      userId
    )
  }

  /** WS control-message dispatch driving the four-method semantics. */
  private async handleControl(ws: WebSocket, msg: ControlMessage): Promise<void> {
    switch (msg.type) {
      case 'create': {
        if (!this.authUserId) {
          ws.close(1008, 'no authenticated identity')
          return
        }
        // Bind the AUTH-validated user id, NOT any id the client claims.
        const sessionId = this.createSession(
          msg.gameId,
          this.authUserId,
          msg.manualData,
          msg.gameState
        )
        ws.send(JSON.stringify({ type: 'created', sessionId }))
        return
      }
      case 'turn': {
        if (!this.state || !this.userId) {
          ws.close(1008, 'turn before create')
          return
        }
        // Stream the AI response chunks back. Text rides as JSON; audio is
        // base64-encoded so the whole turn stays on the JSON text channel and
        // the binary frame direction remains player-audio-only.
        const sessionId = this.ctx.id.toString()
        for await (const chunk of this.onAiResponse(sessionId, this.userId)) {
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
        return
      }
      case 'end': {
        if (this.state && this.userId) {
          const summary = this.endSession(this.ctx.id.toString(), this.userId)
          ws.send(JSON.stringify({ type: 'summary', summary }))
        }
        ws.close(1000, 'session ended')
        return
      }
    }
  }
}
