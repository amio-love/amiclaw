import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class tests for `VoiceSessionDO`'s session-terminal usage flush.
 *
 * The sibling `session-usage-flush.test.ts` covers the pure `usage-flush.ts`
 * core (key scheme, record shape, fail-open write); these tests own the DO's
 * terminal-path wiring — flush placement in `endSession`, the `ctx.waitUntil`
 * registration, the per-session `usageFlushed` guard — by driving the REAL
 * `VoiceSessionDO` under the workerd runtime (`@cloudflare/vitest-pool-workers`):
 *
 *  - The DO is the genuine Cloudflare Durable Object, instantiated through the
 *    `VOICE_SESSION` binding (`cloudflare:workers` is NOT mocked). `handle.run`
 *    (`runInDurableObject`) reaches the real instance to drive a contract method
 *    directly, to spy on the real `ctx.waitUntil` (the flush's lifecycle
 *    registration seam — `registered` below replaces the old recording-ctx
 *    double), and to overwrite `instance.env` so the suite can inject a recording
 *    / failing / absent USAGE KV exactly as before.
 *  - The WS terminal paths (`end` control message, abrupt owner-socket close)
 *    are driven over a real client WebSocket; the DO's `server.close(...)`
 *    surfaces as client `close` events. WS delivery is async, so the suite waits
 *    on observable effects (the recorded put, the close event) rather than a
 *    single macrotask tick.
 */

import type { ManualData } from './contract'
import type { UsageCounters } from './turn-pipeline'
import type { UsageKvWriter } from './usage-flush'
import type { SessionDoEnv } from './session-do'
import {
  createSessionOverWs,
  makeSessionDo,
  messagesOfType,
  openSocket,
  settle,
  UUID_RE,
  waitFor,
  waitForMessage,
  type SessionHandle,
} from './session-do-test-kit'

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

// --- harness -------------------------------------------------------------------

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

/**
 * Real-instance ctx observation: the `registered` array records every promise
 * the DO hands to `ctx.waitUntil` (the flush's lifecycle registration — the
 * assertion that a flush is registered, not bare-voided). `id` is the genuine DO
 * id, distinct from any minted session UUID. Both are captured by reaching into
 * the resident instance with `runInDurableObject` and spying on the real ctx.
 */
interface CtxView {
  readonly registered: Promise<unknown>[]
  readonly id: string
}

/**
 * Bind a fresh `VoiceSessionDO`, inject the given USAGE binding into its env
 * (memory-less — no companion bindings, as the prior Node harness), and spy on
 * the real `ctx.waitUntil` so the flush's lifecycle registration is observable.
 */
async function makeDo(usage?: UsageKvWriter): Promise<{ handle: SessionHandle; ctx: CtxView }> {
  const handle = makeSessionDo()
  const registered: Promise<unknown>[] = []
  const id = await handle.run((instance, state) => {
    ;(instance as unknown as { env: SessionDoEnv }).env = (
      usage === undefined ? {} : { USAGE: usage }
    ) as SessionDoEnv
    const original = state.waitUntil.bind(state)
    vi.spyOn(state, 'waitUntil').mockImplementation((promise: Promise<unknown>) => {
      registered.push(promise)
      return original(promise)
    })
    return state.id.toString()
  })
  return { handle, ctx: { registered, id } }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// --- direct contract path: endSession is the flush boundary ---------------------

describe('real VoiceSessionDO — direct endSession flush', () => {
  it('flushes one record via ctx.waitUntil, keyed usage:{date}:{userId}:{sessionId UUID}', async () => {
    const kv = new RecordingUsageKv()
    const { handle, ctx } = await makeDo(kv)

    const { sessionId, summary } = await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL)
      const sum = instance.endSession(sid, 'user-A')
      return { sessionId: sid, summary: sum }
    })

    // The session identity is a freshly minted UUID, never the DO id.
    expect(sessionId).toMatch(UUID_RE)
    expect(sessionId).not.toBe(ctx.id)
    expect(summary.sessionId).toBe(sessionId)
    expect(summary.turnCount).toBe(0)

    // The flush promise is registered on the DO lifecycle, not bare-voided.
    expect(ctx.registered).toHaveLength(1)
    await waitFor(() => kv.puts.length === 1, 'one recorded put')

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
    const { handle, ctx } = await makeDo(kv)

    // `endSession` does not clear the session (teardown belongs to the WS
    // branch / owner-close), so a second direct call passes the state checks;
    // the real class's `usageFlushed` guard must absorb it.
    await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL)
      instance.endSession(sid, 'user-A')
      instance.endSession(sid, 'user-A')
    })

    expect(ctx.registered).toHaveLength(1)
    await waitFor(() => kv.puts.length === 1, 'one recorded put')
    expect(kv.puts).toHaveLength(1)
  })
})

// --- WS terminal paths: end branch + owner-socket close --------------------------

describe('real VoiceSessionDO — WS terminal paths', () => {
  it('an end message followed by the owner-socket close event writes once', async () => {
    const kv = new RecordingUsageKv()
    const { handle, ctx } = await makeDo(kv)
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')
    // The end branch answered with the summary and a clean 1000 close.
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'session ended' })
    // The owner-socket close event the runtime fires AFTER the 1000:
    // `clearSession` already unbound the owner, so the close branch must not
    // double-flush.
    await settle()

    expect(ctx.registered).toHaveLength(1)
    await waitFor(() => kv.puts.length === 1, 'one recorded put')
    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)
  })

  it('an abrupt owner-socket close (no end) flushes exactly once via waitUntil', async () => {
    const kv = new RecordingUsageKv()
    const { handle, ctx } = await makeDo(kv)
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    // Abrupt drop: the socket closes without any `end` control message.
    socket.disconnect()

    await waitFor(() => kv.puts.length === 1, 'one recorded put')
    expect(ctx.registered).toHaveLength(1)
    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)

    // A second close event is a no-op — the session is already cleared.
    socket.disconnect()
    await settle()
    expect(ctx.registered).toHaveLength(1)
    expect(kv.puts).toHaveLength(1)
  })

  it('a same-user duplicate socket close does not flush the still-live session', async () => {
    const kv = new RecordingUsageKv()
    const { handle, ctx } = await makeDo(kv)
    const owner = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(owner)
    // A second tab / reconnect for the SAME user on the same DO.
    const duplicate = await openSocket(handle, 'user-A')

    duplicate.disconnect()
    await settle()
    expect(ctx.registered).toHaveLength(0)
    expect(kv.puts).toHaveLength(0)

    // The owner's close afterwards still flushes the one record.
    owner.disconnect()
    await waitFor(() => kv.puts.length === 1, 'one recorded put')
    expect(ctx.registered).toHaveLength(1)
    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)
  })

  it('the flush guard is per-session: a reconnect session on the same DO flushes again', async () => {
    // Cross-generation correctness: session 1 ends (flushes, guard tripped),
    // a new session opens on the SAME resident DO (`create` resets the guard),
    // and its end must flush AGAIN — under its own minted id.
    const kv = new RecordingUsageKv()
    const { handle, ctx } = await makeDo(kv)

    const first = await openSocket(handle, 'user-A')
    const firstId = await createSessionOverWs(first)
    first.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(first, 'summary')

    const second = await openSocket(handle, 'user-A')
    const secondId = await createSessionOverWs(second)
    second.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(second, 'summary')

    await waitFor(() => kv.puts.length === 2, 'two recorded puts')
    expect(ctx.registered).toHaveLength(2)
    expect(kv.puts).toHaveLength(2)
    expect(firstId).not.toBe(secondId)
    expect(kv.puts[0].key).toContain(`:user-A:${firstId}`)
    expect(kv.puts[1].key).toContain(`:user-A:${secondId}`)
  })
})

// --- fail-open: a broken or absent USAGE KV never reaches the player path --------

describe('real VoiceSessionDO — fail-open', () => {
  it('a failing USAGE.put logs, never throws, and the WS end path closes cleanly', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const kv = new FailingUsageKv()
    const { handle } = await makeDo(kv)
    const socket = await openSocket(handle, 'user-A')
    await createSessionOverWs(socket)

    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')

    // The session-close path is unaffected: summary sent, clean 1000 close (a
    // throw would have surfaced as a 1008 policy close via the listener).
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'session ended' })

    await waitFor(() => kv.attempts === 1, 'one put attempt')
    await waitFor(() => errorSpy.mock.calls.length === 1, 'logged once')
    expect(kv.attempts).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('usage flush failed')
  })

  it('a missing USAGE binding skips silently and endSession still returns the summary', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handle, ctx } = await makeDo()

    const summary = await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL)
      return instance.endSession(sid, 'user-A')
    })

    expect(summary.gameId).toBe('demo-mock')
    expect(ctx.registered).toHaveLength(1)
    await settle()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
