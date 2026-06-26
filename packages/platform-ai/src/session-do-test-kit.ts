/**
 * Test-only doubles and helpers for running the REAL `VoiceSessionDO` under the
 * workerd runtime (`@cloudflare/vitest-pool-workers`). Not part of the package's
 * runtime exports — imported exclusively by the `session-do-*.test.ts` /
 * `session-*.test.ts` suites.
 *
 * The harness pattern (workerd-backed, replaces the prior plain-Node doubles):
 *  - The DO is the REAL Cloudflare Durable Object: it is instantiated by the
 *    runtime through the `VOICE_SESSION` binding declared in
 *    `wrangler.vitest.toml`, never `new`-ed by the test. `cloudflare:workers` is
 *    NOT mocked and `WebSocketPair` / `Response` are NOT stubbed — the suites
 *    exercise the genuine runtime so the same tests hold across the later
 *    Agents-SDK base-class swap.
 *  - Each `makeSessionDo()` binds a UNIQUE DO name, so every test gets a fresh
 *    resident instance (no in-memory state leaks between tests).
 *  - WS paths are driven through a REAL client `WebSocket` obtained from the DO's
 *    `fetch` upgrade (`stub.fetch(...).webSocket`). Inbound control frames are
 *    delivered with `socket.send(...)`; the DO's outbound JSON envelopes are
 *    collected off the client `message` event into `socket.messages`, and its
 *    `server.close(...)` calls surface as client `close` events in
 *    `socket.closeEvents`. Because WS delivery is asynchronous in workerd (unlike
 *    the prior synchronous in-process double), tests synchronize on observable
 *    effects with `waitFor(...)` instead of a bare `tick()`.
 *  - `handle.run(fn)` wraps `runInDurableObject` so a test can reach into the
 *    real instance: drive a contract method directly, spy on `ctx.waitUntil`, or
 *    overwrite `instance.env` to inject a USAGE KV double. It is ALSO the seam
 *    that releases a parked gated turn — resolving a provider promise must happen
 *    inside the DO's I/O context, else workerd rejects the resumed `server.send`
 *    as cross-Durable-Object I/O.
 *  - Providers either wire through the real `assembleSession` ->
 *    `createProviders` path using the `demo-mock` game (credential-free), or —
 *    for tests that must park a turn mid-flight at a provider `await` — through
 *    the gated providers below, injected at the `createProviders` seam with a
 *    passthrough `vi.mock('./providers/factory')` in the test file.
 */

import { env, runInDurableObject } from 'cloudflare:test'
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
import type { VoiceSessionDO } from './session-do'

// --- runtime env handle ----------------------------------------------------------

/** The bindings the session-DO suites consume from `wrangler.vitest.toml`. */
interface TestEnv {
  VOICE_SESSION: DurableObjectNamespace
  USAGE: KVNamespace
}
const testEnv = env as unknown as TestEnv

// --- DO handle + WS driving helpers ----------------------------------------------

/** Shape of the session ids `assembleSession` mints (never the DO id). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A small fixed manual payload for `create` messages. */
export const MANUAL: ManualData = {
  version: 'manual-v1',
  sections: { intro: 'The red ABORT button is a decoy.' },
}

/** A parsed outbound WS protocol message. */
export interface WsMessage {
  type: string
  [k: string]: unknown
}

/**
 * A live client WebSocket to one DO, plus the collected server -> client traffic.
 * `messages` accrues every JSON envelope the DO sends; `closeEvents` accrues the
 * `server.close(code, reason)` calls (surfaced as client `close` events).
 */
export class TestSocket {
  readonly messages: WsMessage[] = []
  readonly closeEvents: Array<{ code: number; reason: string }> = []

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') this.messages.push(JSON.parse(event.data) as WsMessage)
    })
    ws.addEventListener('close', (event: CloseEvent) => {
      this.closeEvents.push({ code: event.code, reason: event.reason })
    })
  }

  /** Deliver one inbound frame to the DO (client -> server). */
  send(data: string | ArrayBuffer): void {
    this.ws.send(data)
  }

  /** Close the client side — the runtime fires the DO's `close` listener. */
  disconnect(): void {
    this.ws.close()
  }

  /** This socket's collected outbound messages of one protocol type. */
  messagesOfType(type: string): WsMessage[] {
    return this.messages.filter((message) => message.type === type)
  }

  /** Whether the turn's terminal `done: true` chunk has arrived on the socket. */
  sawDoneChunk(): boolean {
    return this.messagesOfType('chunk').some((chunk) => chunk.done === true)
  }
}

/** A handle to one resident `VoiceSessionDO`, addressed by a unique DO name. */
export interface SessionHandle {
  readonly name: string
  readonly stub: DurableObjectStub<VoiceSessionDO>
  /**
   * Run `fn` inside the DO's own I/O context (via `runInDurableObject`): call a
   * contract method directly, spy on `ctx.waitUntil`, overwrite `instance.env`,
   * or release a parked gated turn (the resumed `server.send` then runs
   * in-context). The instance is the real `VoiceSessionDO`.
   */
  run<R>(fn: (instance: VoiceSessionDO, state: DurableObjectState) => R | Promise<R>): Promise<R>
}

let doSeq = 0

/** Bind a fresh, uniquely-named resident `VoiceSessionDO`. */
export function makeSessionDo(): SessionHandle {
  doSeq += 1
  const name = `session-do-${doSeq}-${crypto.randomUUID()}`
  const stub = testEnv.VOICE_SESSION.get(
    testEnv.VOICE_SESSION.idFromName(name)
  ) as DurableObjectStub<VoiceSessionDO>
  return {
    name,
    stub,
    run<R>(
      fn: (instance: VoiceSessionDO, state: DurableObjectState) => R | Promise<R>
    ): Promise<R> {
      return runInDurableObject(stub, fn)
    },
  }
}

/** The USAGE KV namespace bound for the suite (read-back assertions). */
export const usageKv = (): KVNamespace => testEnv.USAGE

/** Run the real `fetch` upgrade for an authenticated user; return the client socket. */
export async function openSocket(handle: SessionHandle, userId: string): Promise<TestSocket> {
  const response = await handle.stub.fetch(`https://voice-session/ai-ws/${handle.name}`, {
    // `x-partykit-room` lets partyserver (the Agents-SDK base) resolve the room
    // name on a direct `stub.fetch` — the production path uses `getAgentByName`,
    // which sets it; here it is supplied explicitly. Harmless for the raw DO.
    headers: {
      Upgrade: 'websocket',
      'X-Session-User-Id': userId,
      'x-partykit-room': handle.name,
    },
  })
  if (response.status !== 101) {
    throw new Error(`expected a 101 upgrade, got ${response.status}`)
  }
  const client = response.webSocket
  if (!client) throw new Error('no webSocket on the upgrade response')
  client.accept()
  return new TestSocket(client)
}

/**
 * Poll `predicate` until it holds, or fail with `label`. Replaces the prior
 * synchronous-double's `tick()`: workerd WS delivery + DO processing are async,
 * so tests synchronize on the observable effect (an arrived message, a started
 * turn, a recorded put) rather than a fixed number of macrotasks.
 */
export async function waitFor(
  predicate: () => boolean,
  label: string,
  budgetMs = 1000
): Promise<void> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (predicate()) return
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${label}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
}

/** Wait until the socket has received a message of `type`. */
export function waitForMessage(socket: TestSocket, type: string): Promise<void> {
  return waitFor(() => socket.messagesOfType(type).length > 0, `message ${type}`)
}

/**
 * Let pending WS delivery + DO processing drain, so a "nothing further happens"
 * assertion is meaningful. A short fixed settle is sufficient because the
 * relevant positive signal each test depends on is awaited explicitly first.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
}

/**
 * Send the `create` control message over the socket; return the minted session
 * id. Awaits the `created` ack (the DO's create branch first awaits the
 * best-effort, here absent, companion-context resolution).
 */
export async function createSessionOverWs(
  socket: TestSocket,
  gameId = 'demo-mock'
): Promise<string> {
  socket.send(JSON.stringify({ type: 'create', gameId, manualData: MANUAL }))
  await waitForMessage(socket, 'created')
  const created = socket.messagesOfType('created').at(-1) as { type: string; sessionId?: string }
  if (created.sessionId === undefined) throw new Error('created ack carried no sessionId')
  return created.sessionId
}

/** The socket's outbound messages of one protocol type (free-function form). */
export function messagesOfType(socket: TestSocket, type: string): WsMessage[] {
  return socket.messagesOfType(type)
}

/** Whether the turn's terminal `done: true` chunk was sent on the socket. */
export function sawDoneChunk(socket: TestSocket): boolean {
  return socket.sawDoneChunk()
}

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
 * Byte-INSPECTING STT — the counting STT's sibling for audio-FIDELITY assertions.
 *
 * The counting STT above drains the bridge without looking at the bytes ("frames
 * are consumed, not inspected"), so it cannot tell a byte-intact frame from an
 * empty one — exactly the blind spot that hid the binary-conversion P1. This
 * variant additionally CAPTURES every frame it pulls (copied at capture time, so
 * a later reuse/mutation of the source view can never retroactively rewrite what
 * was recorded), letting a test assert the bytes that reached STT are non-empty
 * and byte-equal to what the client sent. It does NOT replace the counting STT —
 * suites that only need "a turn started" keep using `makeCountingStt`.
 */
function makeInspectingStt(): {
  stt: SttProvider
  calls(): number
  frames(): Uint8Array[]
  bytes(): Uint8Array
} {
  let calls = 0
  const captured: Uint8Array[] = []
  const stt: SttProvider = {
    async *transcribe(audio): AsyncIterable<SttTranscriptChunk> {
      calls += 1
      for await (const frame of audio) {
        captured.push(new Uint8Array(frame))
      }
      yield { text: 'inspecting harness utterance', isFinal: true }
    },
  }
  const bytes = (): Uint8Array => {
    const total = captured.reduce((n, f) => n + f.byteLength, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const f of captured) {
      out.set(f, offset)
      offset += f.byteLength
    }
    return out
  }
  return { stt, calls: () => calls, frames: () => captured, bytes }
}

/**
 * Provider bundle whose STT captures the audio frames it pulls (`frames`/`bytes`)
 * for byte-level fidelity assertions; the LLM completes immediately so the turn
 * runs end-to-end with no manual release (no parking — STT drains the buffered
 * audio, one sentence is synthesized, the turn emits its terminal `done` chunk).
 */
export function makeInspectingProviders(): {
  providers: TurnProviders
  sttCalls(): number
  frames(): Uint8Array[]
  bytes(): Uint8Array
} {
  const inspect = makeInspectingStt()
  const llm: LlmProvider = {
    async *streamCompletion() {
      yield { content: 'ok.', done: true }
    },
  }
  return {
    providers: { stt: inspect.stt, llm, tts: createMockTtsProvider() },
    sttCalls: inspect.calls,
    frames: inspect.frames,
    bytes: inspect.bytes,
  }
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
