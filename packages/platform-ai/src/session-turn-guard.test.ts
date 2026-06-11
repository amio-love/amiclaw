import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression tests for the turn in-flight guard and the DO
 * cross-await reentrancy matrix (the P1 from PR #156 review), driving the REAL
 * `VoiceSessionDO` in Node — these replaced the earlier `FakeSessionDo` mirror
 * suite, whose green could not prove the real class still carried the guard.
 *
 * Harness (see `session-do-test-kit.ts` and the pattern's SSOT,
 * `session-do-usage-flush.test.ts`): `cloudflare:workers` is mocked to a plain
 * ctx/env-stashing base, `WebSocketPair` / `Response` globals are stubbed to
 * minimal doubles, and sockets are driven through the real `fetch` upgrade
 * entry. Turn parking is real: `createProviders` is passed through except when
 * a test installs the gated provider bundle, whose LLM stream suspends `runTurn`
 * at a genuinely pending provider `await` — exactly the cross-await window an
 * interleaved control message arrives in. The defect's shape: a second `turn`
 * mid-flight would start a second `runTurn` over the same
 * `state`/`providers`/socket, racing shared `history`/`usage` and interleaving
 * two response streams; `end` / owner-close must instead cancel cleanly.
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

const providerControl = vi.hoisted(() => ({
  override: undefined as import('./turn-pipeline').TurnProviders | undefined,
}))

vi.mock('./providers/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/factory')>()
  return {
    ...actual,
    createProviders: (...args: Parameters<typeof actual.createProviders>) =>
      providerControl.override ?? actual.createProviders(...args),
  }
})

import {
  createSessionOverWs,
  FakeUpgradeResponse,
  FakeWebSocketPair,
  makeGatedProviders,
  makeSessionDo,
  makeStuckLlm,
  makeThrowingLlm,
  makeTurnProviders,
  messagesOfType,
  openSocket,
  resetCreatedPairs,
  sawDoneChunk,
  tick,
} from './session-do-test-kit'

vi.stubGlobal('WebSocketPair', FakeWebSocketPair)
vi.stubGlobal('Response', FakeUpgradeResponse)

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  resetCreatedPairs()
  providerControl.override = undefined
})

const TURN = JSON.stringify({ type: 'turn' })
const END = JSON.stringify({ type: 'end' })

// --- the in-flight turn guard ------------------------------------------------

describe('real VoiceSessionDO — turn in-flight guard (P1)', () => {
  it('rejects a second turn while the first is in flight; no second runTurn starts', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    // First turn starts and parks at the gated LLM await (a real turn mid-flight).
    socket.receive(TURN)
    await tick()
    expect(kit.sttCalls()).toBe(1)
    expect(kit.llmTurns).toHaveLength(1)

    // Owner double-clicks: a second `turn` arrives while the first is parked.
    socket.receive(TURN)
    await tick()

    // Rejected with an explicit signal — NOT a second runTurn, NOT a socket close.
    expect(messagesOfType(socket, 'error')).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })
    expect(kit.sttCalls()).toBe(1)
    expect(socket.closes).toEqual([])

    // The first turn still completes normally — no concurrent pollution.
    kit.llmTurns[0].pushDelta('The first wire is safe.')
    await tick()
    kit.llmTurns[0].finishStream()
    await tick()
    expect(kit.llmTurns[0].settled()).toBe(true)
    expect(sawDoneChunk(socket)).toBe(true)

    // Exactly one turn counted in the summary.
    socket.receive(END)
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })

  it('clears the guard after a turn so a subsequent turn runs normally', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    socket.receive(TURN)
    await tick()
    kit.llmTurns[0].finishStream()
    await tick()
    expect(kit.llmTurns[0].settled()).toBe(true)

    // A fresh turn after the first completes is accepted (a real second runTurn).
    socket.receive(TURN)
    await tick()
    expect(kit.sttCalls()).toBe(2)
    expect(kit.llmTurns).toHaveLength(2)
    kit.llmTurns[1].finishStream()
    await tick()
    expect(kit.llmTurns[1].settled()).toBe(true)
    expect(messagesOfType(socket, 'error')).toEqual([])

    socket.receive(END)
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(2)
  })

  it('clears the guard even when the turn throws (exception cannot wedge it shut)', async () => {
    const throwing = makeThrowingLlm('provider boom')
    const bundle = makeTurnProviders(throwing.llm)
    providerControl.override = bundle.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    // The provider rejects at the LLM step; the listener fail-louds with 1008.
    socket.receive(TURN)
    await tick()
    expect(throwing.calls()).toBe(1)
    expect(socket.closes).toContainEqual({ code: 1008, reason: 'provider boom' })

    // The guard is released despite the throw: the next turn REACHES the
    // provider again instead of bouncing off a wedged turn_in_flight guard.
    socket.receive(TURN)
    await tick()
    expect(throwing.calls()).toBe(2)
    expect(messagesOfType(socket, 'error').filter((m) => m.code === 'turn_in_flight')).toEqual([])
  })
})

// --- end during a turn cleanly cancels ---------------------------------------

describe('real VoiceSessionDO — end during a turn (matrix: end)', () => {
  it('cancels the in-flight turn: immediate summary, clean unwind, no settle', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    socket.receive(TURN)
    await tick()
    // Let one chunk through so the turn is genuinely mid-stream.
    kit.llmTurns[0].pushDelta('partial')
    await tick()
    expect(kit.llmTurns[0].settled()).toBe(false)

    // `end` arrives mid-turn: the summary + clean close land SYNCHRONOUSLY,
    // before the background cancel's unwind — proving `end` never blocks on it.
    socket.receive(END)
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    expect(socket.closes).toContainEqual({ code: 1000, reason: 'session ended' })
    expect(kit.llmTurns[0].finallyRan()).toBe(false)
    // The canceled turn never settles, so it does not count.
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)

    // The parked provider await then settles; the queued cancel unwinds the
    // turn (provider `finally` ran, streams returned) WITHOUT reaching settle.
    kit.llmTurns[0].pushDelta('late')
    await tick()
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)
    expect(sawDoneChunk(socket)).toBe(false)
  })

  it('end with no turn in flight is a no-op cancel and still summarizes', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    socket.receive(END)

    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)
    expect(socket.closes).toContainEqual({ code: 1000, reason: 'session ended' })
    expect(kit.sttCalls()).toBe(0)
  })

  it('does not hang when the in-flight turn is parked at a never-settling provider await (F-J)', async () => {
    // F-J: `AsyncIterator.return()` cannot interrupt a pending provider `await`;
    // if `end` awaited the cancel it would hang for as long as the provider is
    // stuck. The fire-and-forget cancel must let `end` summarize + close
    // promptly regardless.
    const stuck = makeStuckLlm()
    const bundle = makeTurnProviders(stuck.llm)
    providerControl.override = bundle.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    socket.receive(TURN)
    await tick()
    expect(bundle.sttCalls()).toBe(1)

    // `end` lands synchronously even though the turn's cancel can never settle.
    socket.receive(END)
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    expect(socket.closes).toContainEqual({ code: 1000, reason: 'session ended' })

    // The stuck turn's `finally` never ran (the provider await is still
    // pending) — proving `end` did not block on the cancel.
    await tick()
    expect(stuck.finallyRan()).toBe(false)
  })
})

// --- create during a turn is rejected ----------------------------------------

describe('real VoiceSessionDO — create during a turn (matrix: create)', () => {
  it('rejects a re-create and leaves the in-flight session + turn untouched', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    const sessionId = createSessionOverWs(socket)

    socket.receive(TURN)
    await tick()

    // A second `create` arrives mid-turn: explicit reject, no socket close (a
    // close would truncate the turn streaming on this same socket).
    socket.receive(JSON.stringify({ type: 'create', gameId: 'demo-mock', manualData: {} }))
    expect(messagesOfType(socket, 'error')).toContainEqual({
      type: 'error',
      code: 'already_created',
      message: 'session already created',
    })
    expect(socket.closes).toEqual([])

    // The live session was not clobbered: the same turn completes and the
    // summary still carries the ORIGINAL session id.
    kit.llmTurns[0].finishStream()
    await tick()
    expect(kit.llmTurns[0].settled()).toBe(true)
    expect(sawDoneChunk(socket)).toBe(true)
    socket.receive(END)
    const summary = messagesOfType(socket, 'summary')[0].summary as {
      sessionId: string
      turnCount: number
    }
    expect(summary.sessionId).toBe(sessionId)
    expect(summary.turnCount).toBe(1)
  })
})

// --- owner socket close during a turn cancels --------------------------------

describe('real VoiceSessionDO — owner close during a turn (matrix: close)', () => {
  it('owner close cancels the in-flight turn cleanly (no settle, no done chunk)', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    socket.receive(TURN)
    await tick()
    kit.llmTurns[0].pushDelta('x')
    await tick()

    // Owner's socket drops mid-turn (network drop / tab close).
    socket.disconnect()

    // The parked provider await settles later; the queued cancel unwinds the
    // turn cleanly — provider `finally` ran, settle never reached.
    kit.llmTurns[0].pushDelta('late')
    await tick()
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)
    expect(sawDoneChunk(socket)).toBe(false)
  })
})
