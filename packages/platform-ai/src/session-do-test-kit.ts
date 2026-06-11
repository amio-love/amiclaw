/**
 * Test-only doubles and helpers for running the REAL `VoiceSessionDO` in the
 * Node test environment. Not part of the package's runtime exports — imported
 * exclusively by the `session-do-*.test.ts` / `session-*.test.ts` suites.
 *
 * The harness pattern (established by `session-do-usage-flush.test.ts`):
 *  - `cloudflare:workers` is mocked PER TEST FILE (vi.mock must live in the
 *    test file to be hoisted) so the `DurableObject` base becomes a plain
 *    ctx/env-stashing stub — the only base behavior the class relies on.
 *  - `ctx` is a recording double exposing the one member the class uses
 *    (`waitUntil`), plus an `id` to prove the usage key never uses the DO id.
 *  - The WS paths are driven through the real `fetch` upgrade entry with
 *    `WebSocketPair` / `Response` globals stubbed (also per test file, via
 *    `vi.stubGlobal`) to the minimal doubles exported here. The DO accepts
 *    sockets with a plain `accept()` + `addEventListener` (no hibernation
 *    attachments), so the socket double needs only those members. Node's own
 *    `Response` rejects status 101, hence the stub.
 *  - Providers either wire through the real `assembleSession` ->
 *    `createProviders` path using the `demo-mock` game (credential-free), or —
 *    for tests that must park a turn mid-flight at a provider `await` — through
 *    the gated providers below, injected at the `createProviders` seam with a
 *    passthrough `vi.mock('./providers/factory')` in the test file.
 */

import type { ManualData } from './contract'
import type {
  LlmCompletionRequest,
  LlmProvider,
  LlmUsage,
  SttProvider,
  SttTranscriptChunk,
} from './providers/types'
import { createMockTtsProvider } from './providers/mock'
import type { TurnProviders } from './turn-pipeline'
import type { UsageKvWriter } from './usage-flush'
import { VoiceSessionDO, type SessionDoEnv } from './session-do'

// --- WS / DO doubles -------------------------------------------------------------

type MessageListener = (event: { data: string | ArrayBuffer }) => void
type CloseListener = () => void

/**
 * Minimal server-socket double for the DO's non-hibernating WS usage surface:
 * `binaryType` assignment, `accept()`, `addEventListener('message'|'close')`,
 * `send`, `close`. Tests deliver frames with `receive()` and fire the close
 * event with `disconnect()` — exactly what the runtime would do.
 */
export class FakeWebSocket {
  binaryType: string | undefined
  accepted = false
  readonly sent: string[] = []
  readonly closes: Array<{ code?: number; reason?: string }> = []
  private readonly messageListeners: MessageListener[] = []
  private readonly closeListeners: CloseListener[] = []

  accept(): void {
    this.accepted = true
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason })
  }

  addEventListener(type: string, listener: MessageListener | CloseListener): void {
    if (type === 'message') this.messageListeners.push(listener as MessageListener)
    if (type === 'close') this.closeListeners.push(listener as CloseListener)
  }

  /** Deliver one inbound frame (fires the 'message' listeners). */
  receive(data: string | ArrayBuffer): void {
    for (const listener of this.messageListeners) listener({ data })
  }

  /** Fire the 'close' event as the runtime would on disconnect. */
  disconnect(): void {
    for (const listener of this.closeListeners) listener()
  }
}

/** Pairs created by the stubbed `WebSocketPair` global, newest last. */
export const createdPairs: Array<{ 0: FakeWebSocket; 1: FakeWebSocket }> = []

/** Stub for the `WebSocketPair` global — registers each pair for `openSocket`. */
export class FakeWebSocketPair {
  0 = new FakeWebSocket()
  1 = new FakeWebSocket()

  constructor() {
    createdPairs.push(this)
  }
}

/** Reset the pair registry between tests. */
export function resetCreatedPairs(): void {
  createdPairs.length = 0
}

/** Node's `Response` rejects status 101; the DO's WS upgrade needs this stub. */
export class FakeUpgradeResponse {
  readonly status: number
  readonly webSocket: unknown

  constructor(_body: unknown, init?: { status?: number; webSocket?: unknown }) {
    this.status = init?.status ?? 200
    this.webSocket = init?.webSocket ?? null
  }
}

/**
 * Recording `DurableObjectState` double — only the surface `VoiceSessionDO`
 * actually touches: `waitUntil` (the flush's lifecycle registration seam) and
 * an `id` distinct from any minted session UUID.
 */
export class FakeDoCtx {
  readonly registered: Promise<unknown>[] = []
  /** Distinct from every minted session UUID — the usage key must never use it. */
  readonly id = { toString: (): string => 'do-id-not-a-session-id' }

  waitUntil(promise: Promise<unknown>): void {
    this.registered.push(promise)
  }
}

// --- DO construction + WS driving helpers ----------------------------------------

/** Shape of the session ids `assembleSession` mints (never the DO id). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A small fixed manual payload for `create` messages. */
export const MANUAL: ManualData = {
  version: 'manual-v1',
  sections: { intro: 'The red ABORT button is a decoy.' },
}

/** Build a real `VoiceSessionDO` over the ctx double + the given USAGE binding. */
export function makeSessionDo(usage?: UsageKvWriter): {
  doInstance: VoiceSessionDO
  ctx: FakeDoCtx
} {
  const ctx = new FakeDoCtx()
  const env = (usage === undefined ? {} : { USAGE: usage }) as SessionDoEnv
  return {
    doInstance: new VoiceSessionDO(ctx as unknown as DurableObjectState, env),
    ctx,
  }
}

/** Run the real `fetch` upgrade for an authenticated user; return the server socket. */
export async function openSocket(
  doInstance: VoiceSessionDO,
  userId: string
): Promise<FakeWebSocket> {
  const request = {
    headers: {
      get(name: string): string | null {
        if (name === 'Upgrade') return 'websocket'
        if (name === 'X-Session-User-Id') return userId
        return null
      },
    },
  } as unknown as Request
  const response = await doInstance.fetch(request)
  if (response.status !== 101) {
    throw new Error(`expected a 101 upgrade, got ${response.status}`)
  }
  return createdPairs[createdPairs.length - 1][1]
}

/** Send the `create` control message over the socket; return the minted session id. */
export function createSessionOverWs(socket: FakeWebSocket, gameId = 'demo-mock'): string {
  socket.receive(JSON.stringify({ type: 'create', gameId, manualData: MANUAL }))
  const raw = socket.sent[socket.sent.length - 1]
  const created = JSON.parse(raw) as { type: string; sessionId?: string }
  if (created.type !== 'created' || created.sessionId === undefined) {
    throw new Error(`expected a created ack, got ${raw}`)
  }
  return created.sessionId
}

/** A parsed outbound WS protocol message. */
export interface WsMessage {
  type: string
  [k: string]: unknown
}

/** All messages sent on the socket, parsed. */
export function sentMessages(socket: FakeWebSocket): WsMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as WsMessage)
}

/** The socket's sent messages of one protocol type. */
export function messagesOfType(socket: FakeWebSocket, type: string): WsMessage[] {
  return sentMessages(socket).filter((message) => message.type === type)
}

/** Whether the turn's terminal `done: true` chunk was sent on the socket. */
export function sawDoneChunk(socket: FakeWebSocket): boolean {
  return messagesOfType(socket, 'chunk').some((chunk) => chunk.done === true)
}

/** Let microtasks + one macrotask drain so an awaiting loop reaches its next park. */
export const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

// --- gated providers: park a REAL turn mid-flight at a provider await -------------

/**
 * Per-`streamCompletion`-call control handle for the gated LLM. A real turn
 * driven through `runTurn` parks at the LLM stream's pending `next()` until the
 * test releases a delta — exactly the "suspended at an STT/LLM/TTS `await`"
 * window the reentrancy/cancellation tests interleave control messages into.
 */
export interface GatedTurnHandle {
  /** The completion request this turn sent (history-leak assertions). */
  request: LlmCompletionRequest
  /** Release one streamed text delta to the parked turn. */
  pushDelta(content: string): void
  /** Finish the stream so the turn can run to its settle step. */
  finishStream(): void
  /** True once the provider generator's `finally` ran (clean unwind signal). */
  finallyRan(): boolean
  /** True once the stream fully drained (only a non-canceled turn gets here). */
  settled(): boolean
}

/** The gated provider bundle plus its observability counters. */
export interface GatedProviderKit {
  providers: TurnProviders
  /** One handle per `streamCompletion` call, oldest first (= one per started turn). */
  llmTurns: GatedTurnHandle[]
  /** How many turns reached the STT step — "a runTurn actually started" counter. */
  sttCalls(): number
}

/**
 * A tiny single-producer/single-consumer async feed (same shape as the
 * pipeline's `SentenceQueue`): the test pushes deltas in, the gated provider's
 * generator pulls them via `for await`, parking in between.
 */
class DeltaFeed {
  private buffer: string[] = []
  private resolvers: Array<(r: IteratorResult<string>) => void> = []
  private closed = false

  push(value: string): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve({ value, done: false })
    } else {
      this.buffer.push(value)
    }
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      this.resolvers.shift()?.({ value: undefined, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for (;;) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as string
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<string>>((resolve) => {
        this.resolvers.push(resolve)
      })
      if (next.done) return
      yield next.value
    }
  }
}

/** Instant STT that drains the bridge and counts how many turns started. */
function makeCountingStt(): { stt: SttProvider; calls(): number } {
  let calls = 0
  const stt: SttProvider = {
    async *transcribe(audio): AsyncIterable<SttTranscriptChunk> {
      calls += 1
      for await (const _frame of audio) {
        // frames are consumed, not inspected — matches the mock adapter
      }
      yield { text: 'gated harness utterance', isFinal: true }
    },
  }
  return { stt, calls: () => calls }
}

/** Wrap any LLM into a full provider bundle (counting STT + real mock TTS). */
export function makeTurnProviders(llm: LlmProvider): {
  providers: TurnProviders
  sttCalls(): number
} {
  const { stt, calls } = makeCountingStt()
  return { providers: { stt, llm, tts: createMockTtsProvider() }, sttCalls: calls }
}

/**
 * Build the gated provider bundle. Each `turn` control message ultimately calls
 * `streamCompletion` once; each call gets its own `DeltaFeed` + handle, so
 * multi-turn and multi-session (reconnect) scenarios stay independently
 * controllable through one bundle.
 */
export function makeGatedProviders(): GatedProviderKit {
  const llmTurns: GatedTurnHandle[] = []
  const llm: LlmProvider & { lastUsage?: LlmUsage } = {
    async *streamCompletion(request) {
      const feed = new DeltaFeed()
      let cleaned = false
      let drained = false
      llmTurns.push({
        request,
        pushDelta: (content) => feed.push(content),
        finishStream: () => feed.close(),
        finallyRan: () => cleaned,
        settled: () => drained,
      })
      llm.lastUsage = undefined
      try {
        for await (const content of feed) {
          yield { content, done: false }
        }
        drained = true
        llm.lastUsage = { inputTokens: 12, outputTokens: 24 }
      } finally {
        cleaned = true
      }
    },
  }
  const bundle = makeTurnProviders(llm)
  return { providers: bundle.providers, llmTurns, sttCalls: bundle.sttCalls }
}

/** An LLM whose stream rejects on its first `next()` — a provider that throws. */
export function makeThrowingLlm(message = 'provider boom'): {
  llm: LlmProvider
  calls(): number
} {
  let calls = 0
  const llm: LlmProvider = {
    // Rejects before producing any chunk; it intentionally never yields.
    // eslint-disable-next-line require-yield
    async *streamCompletion() {
      calls += 1
      throw new Error(message)
    },
  }
  return { llm, calls: () => calls }
}

/**
 * An LLM parked at a NEVER-settling provider promise. `return()` on a generator
 * cannot interrupt a pending `await`, so a cancel against this provider can
 * never complete — the F-J "stuck provider" shape.
 */
export function makeStuckLlm(): { llm: LlmProvider; finallyRan(): boolean } {
  let cleaned = false
  const llm: LlmProvider = {
    async *streamCompletion() {
      try {
        await new Promise<void>(() => {
          // intentionally never resolves: models a stuck STT/LLM/TTS promise
        })
        yield { content: 'unreachable', done: false }
      } finally {
        cleaned = true
      }
    },
  }
  return { llm, finallyRan: () => cleaned }
}
