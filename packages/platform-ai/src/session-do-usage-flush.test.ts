import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class tests for `VoiceSessionDO`'s session-terminal usage flush.
 *
 * The sibling `session-usage-flush.test.ts` covers the pure `usage-flush.ts`
 * core plus a faithful `FakeSessionDo` MIRROR of the DO's terminal-path
 * wiring. A mirror passing does not prove the real class still carries the
 * wiring: a regression in `session-do.ts` (flush dropped from `endSession`,
 * `ctx.waitUntil` replaced with a bare void, the `usageFlushed` guard removed)
 * would leave the mirror green. These tests close that gap by instantiating
 * the REAL `VoiceSessionDO` in Node:
 *
 *  - `cloudflare:workers` is mocked so the `DurableObject` base becomes a
 *    plain ctx/env-stashing stub — the only base behavior the class relies on.
 *  - `ctx` is a recording double exposing the one member the class uses
 *    (`waitUntil`), plus an `id` to prove the usage key never uses the DO id.
 *  - `env` carries a recording USAGE KV double; providers wire through the
 *    real `assembleSession` -> `createProviders` path using the `demo-mock`
 *    game (all three layers select the credential-free mock provider).
 *  - The WS terminal paths (`end` control message, abrupt owner-socket close)
 *    are driven through the real `fetch` upgrade entry with `WebSocketPair` /
 *    `Response` globals stubbed to minimal doubles. The DO accepts sockets
 *    with a plain `accept()` + `addEventListener` (no hibernation
 *    attachments), so the socket double needs only those members. Node's own
 *    `Response` rejects status 101, hence the stub.
 */

vi.mock('cloudflare:workers', () => {
  /** Stand-in for the real base: stash `ctx` + `env` like `DurableObject`. */
  class DurableObjectStub {
    protected ctx: unknown
    protected env: unknown

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  return { DurableObject: DurableObjectStub }
})

import { VoiceSessionDO, type SessionDoEnv } from './session-do'
import type { ManualData } from './contract'
import type { UsageCounters } from './turn-pipeline'
import type { UsageKvWriter } from './usage-flush'

// --- doubles -------------------------------------------------------------------

/** Recording KV double implementing the structural `put` slice. */
class RecordingUsageKv implements UsageKvWriter {
  readonly puts: Array<{ key: string; value: string }> = []

  async put(key: string, value: string): Promise<void> {
    this.puts.push({ key, value })
  }
}

/** KV double whose every put rejects — the fail-open injection point. */
class FailingUsageKv implements UsageKvWriter {
  attempts = 0

  async put(): Promise<void> {
    this.attempts += 1
    throw new Error('kv unavailable')
  }
}

/**
 * Recording `DurableObjectState` double — only the surface `VoiceSessionDO`
 * actually touches: `waitUntil` (the flush's lifecycle registration seam) and
 * an `id` distinct from any minted session UUID.
 */
class FakeDoCtx {
  readonly registered: Promise<unknown>[] = []
  /** Distinct from every minted session UUID — the usage key must never use it. */
  readonly id = { toString: (): string => 'do-id-not-a-session-id' }

  waitUntil(promise: Promise<unknown>): void {
    this.registered.push(promise)
  }
}

type MessageListener = (event: { data: string | ArrayBuffer }) => void
type CloseListener = () => void

/**
 * Minimal server-socket double for the DO's non-hibernating WS usage surface:
 * `binaryType` assignment, `accept()`, `addEventListener('message'|'close')`,
 * `send`, `close`. Tests deliver frames with `receive()` and fire the close
 * event with `disconnect()` — exactly what the runtime would do.
 */
class FakeWebSocket {
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
const createdPairs: Array<{ 0: FakeWebSocket; 1: FakeWebSocket }> = []

class FakeWebSocketPair {
  0 = new FakeWebSocket()
  1 = new FakeWebSocket()

  constructor() {
    createdPairs.push(this)
  }
}

/** Node's `Response` rejects status 101; the DO's WS upgrade needs this stub. */
class FakeUpgradeResponse {
  readonly status: number
  readonly webSocket: unknown

  constructor(_body: unknown, init?: { status?: number; webSocket?: unknown }) {
    this.status = init?.status ?? 200
    this.webSocket = init?.webSocket ?? null
  }
}

vi.stubGlobal('WebSocketPair', FakeWebSocketPair)
vi.stubGlobal('Response', FakeUpgradeResponse)

afterAll(() => {
  vi.unstubAllGlobals()
})

// --- harness -------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const ZERO_COUNTERS: UsageCounters = {
  llmInputTokens: 0,
  llmOutputTokens: 0,
  sttInputSeconds: 0,
  ttsOutputSeconds: 0,
}

const MANUAL: ManualData = {
  version: 'manual-v1',
  sections: { intro: 'The red ABORT button is a decoy.' },
}

/** Build a real `VoiceSessionDO` over the ctx double + the given USAGE binding. */
function makeDo(usage?: UsageKvWriter): { doInstance: VoiceSessionDO; ctx: FakeDoCtx } {
  const ctx = new FakeDoCtx()
  const env = (usage === undefined ? {} : { USAGE: usage }) as SessionDoEnv
  return {
    doInstance: new VoiceSessionDO(ctx as unknown as DurableObjectState, env),
    ctx,
  }
}

/** Run the real `fetch` upgrade for an authenticated user; return the server socket. */
async function openSocket(doInstance: VoiceSessionDO, userId: string): Promise<FakeWebSocket> {
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
  expect(response.status).toBe(101)
  return createdPairs[createdPairs.length - 1][1]
}

/** Send the `create` control message over the socket; return the minted session id. */
function createSessionOverWs(socket: FakeWebSocket): string {
  socket.receive(JSON.stringify({ type: 'create', gameId: 'demo-mock', manualData: MANUAL }))
  const created = JSON.parse(socket.sent[socket.sent.length - 1]) as {
    type: string
    sessionId: string
  }
  expect(created.type).toBe('created')
  return created.sessionId
}

beforeEach(() => {
  createdPairs.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

// --- direct contract path: endSession is the flush boundary ---------------------

describe('real VoiceSessionDO — direct endSession flush', () => {
  it('flushes one record via ctx.waitUntil, keyed usage:{date}:{userId}:{sessionId UUID}', async () => {
    const kv = new RecordingUsageKv()
    const { doInstance, ctx } = makeDo(kv)

    const sessionId = doInstance.createSession('demo-mock', 'user-A', MANUAL)
    // The session identity is a freshly minted UUID, never the DO id.
    expect(sessionId).toMatch(UUID_RE)
    expect(sessionId).not.toBe(ctx.id.toString())

    const summary = doInstance.endSession(sessionId, 'user-A')
    expect(summary.sessionId).toBe(sessionId)
    expect(summary.turnCount).toBe(0)

    // The flush promise is registered on the DO lifecycle, not bare-voided.
    expect(ctx.registered).toHaveLength(1)
    await Promise.all(ctx.registered)

    expect(kv.puts).toHaveLength(1)
    const utcDate = new Date().toISOString().slice(0, 10)
    expect(kv.puts[0].key).toBe(`usage:${utcDate}:user-A:${sessionId}`)
    const record = JSON.parse(kv.puts[0].value) as {
      gameId: string
      turnCount: number
      usage: UsageCounters
      sttSource: string
    }
    expect(record.gameId).toBe('demo-mock')
    expect(record.turnCount).toBe(0)
    expect(record.usage).toEqual(ZERO_COUNTERS)
    expect(record.sttSource).toBe('provider-reported')
  })

  it('a repeated direct endSession stays guarded — one write, one registration', async () => {
    const kv = new RecordingUsageKv()
    const { doInstance, ctx } = makeDo(kv)
    const sessionId = doInstance.createSession('demo-mock', 'user-A', MANUAL)

    // `endSession` does not clear the session (teardown belongs to the WS
    // branch / owner-close), so a second direct call passes the state checks;
    // the real class's `usageFlushed` guard must absorb it.
    doInstance.endSession(sessionId, 'user-A')
    doInstance.endSession(sessionId, 'user-A')

    expect(ctx.registered).toHaveLength(1)
    await Promise.all(ctx.registered)
    expect(kv.puts).toHaveLength(1)
  })
})

// --- WS terminal paths: end branch + owner-socket close --------------------------

describe('real VoiceSessionDO — WS terminal paths', () => {
  it('an end message followed by the owner-socket close event writes once', async () => {
    const kv = new RecordingUsageKv()
    const { doInstance, ctx } = makeDo(kv)
    const socket = await openSocket(doInstance, 'user-A')
    const sessionId = createSessionOverWs(socket)

    socket.receive(JSON.stringify({ type: 'end' }))
    // The end branch answered with the summary and a clean 1000 close.
    const last = JSON.parse(socket.sent[socket.sent.length - 1]) as { type: string }
    expect(last.type).toBe('summary')
    expect(socket.closes).toEqual([{ code: 1000, reason: 'session ended' }])
    // The close event that follows in the runtime: `clearSession` already
    // unbound the owner, so the close branch must not double-flush.
    socket.disconnect()

    expect(ctx.registered).toHaveLength(1)
    await Promise.all(ctx.registered)
    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)
  })

  it('an abrupt owner-socket close (no end) flushes exactly once via waitUntil', async () => {
    const kv = new RecordingUsageKv()
    const { doInstance, ctx } = makeDo(kv)
    const socket = await openSocket(doInstance, 'user-A')
    const sessionId = createSessionOverWs(socket)

    // Abrupt drop: the socket closes without any `end` control message.
    socket.disconnect()

    expect(ctx.registered).toHaveLength(1)
    await Promise.all(ctx.registered)
    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)

    // A second close event is a no-op — the session is already cleared.
    socket.disconnect()
    expect(ctx.registered).toHaveLength(1)
    expect(kv.puts).toHaveLength(1)
  })

  it('a same-user duplicate socket close does not flush the still-live session', async () => {
    const kv = new RecordingUsageKv()
    const { doInstance, ctx } = makeDo(kv)
    const owner = await openSocket(doInstance, 'user-A')
    const sessionId = createSessionOverWs(owner)
    // A second tab / reconnect for the SAME user on the same DO.
    const duplicate = await openSocket(doInstance, 'user-A')

    duplicate.disconnect()
    expect(ctx.registered).toHaveLength(0)
    expect(kv.puts).toHaveLength(0)

    // The owner's close afterwards still flushes the one record.
    owner.disconnect()
    expect(ctx.registered).toHaveLength(1)
    await Promise.all(ctx.registered)
    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)
  })
})

// --- fail-open: a broken or absent USAGE KV never reaches the player path --------

describe('real VoiceSessionDO — fail-open', () => {
  it('a failing USAGE.put logs, never throws, and the WS end path closes cleanly', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const kv = new FailingUsageKv()
    const { doInstance, ctx } = makeDo(kv)
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    socket.receive(JSON.stringify({ type: 'end' }))

    // The session-close path is unaffected: summary sent, clean 1000 close (a
    // throw would have surfaced as a 1008 policy close via the listener).
    const last = JSON.parse(socket.sent[socket.sent.length - 1]) as { type: string }
    expect(last.type).toBe('summary')
    expect(socket.closes).toEqual([{ code: 1000, reason: 'session ended' }])

    await Promise.all(ctx.registered)
    expect(kv.attempts).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('usage flush failed')
  })

  it('a missing USAGE binding skips silently and endSession still returns the summary', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { doInstance, ctx } = makeDo()

    const sessionId = doInstance.createSession('demo-mock', 'user-A', MANUAL)
    const summary = doInstance.endSession(sessionId, 'user-A')

    expect(summary.gameId).toBe('demo-mock')
    expect(ctx.registered).toHaveLength(1)
    await Promise.all(ctx.registered)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
