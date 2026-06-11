import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression tests for the session-generation EPOCH guard
 * (the P2 from PR #156 review, raised by the prior `clearSession` fix), driving
 * the REAL `VoiceSessionDO` in Node — these replaced the earlier
 * `FakeSessionDo` mirror suite, whose green could not prove the real class
 * still carried the guard.
 *
 * Harness (see `session-do-test-kit.ts` and the pattern's SSOT,
 * `session-do-usage-flush.test.ts`): mocked `cloudflare:workers` base, stubbed
 * `WebSocketPair` / `Response` globals, sockets driven through the real `fetch`
 * upgrade, and the gated provider bundle installed at the `createProviders`
 * seam so each generation's turn parks at a genuinely pending provider `await`.
 *
 * The defect's shape (cross-generation clobber): `end` / owner-close mid-turn
 * fire-and-forget the cancel and `clearSession()` makes the same-named DO
 * immediately reusable, but the canceled turn's loop `finally` runs LATER, when
 * its provider promise finally settles. If a client reconnects in that window —
 * `create`s a fresh session and starts a NEW turn — an UNCONDITIONAL clear in
 * the stale `finally` would (1) reopen the overlap guard so the new session is
 * again attackable by an overlapping `turn`, and (2) null out the new
 * `activeTurn` so the new turn can no longer be canceled by `end`. The fix:
 * each turn captures its generation (`myEpoch`); `clearSession` bumps
 * `turnEpoch`; a stale `finally` from an ended generation is a no-op.
 *
 * Behavior mapping for the retired mirror's normal-flow regression tests:
 * guard-released-after-completion and overlap-rejected-within-one-session live
 * in `session-turn-guard.test.ts`; end-with-no-interleave cancel + clear + late
 * unwind lives in `session-end-cleanup.test.ts`.
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

// --- the cross-generation race: stale finally must NOT clobber the new session --

describe('real VoiceSessionDO — epoch guard, stale finally is a no-op (P2)', () => {
  it('end mid-turn → reconnect create + new turn → stale finally settles late and is a no-op', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()

    // Generation 1: an owner session with a turn parked at a provider await.
    const socket1 = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket1)
    socket1.receive(TURN)
    await tick()
    expect(kit.sttCalls()).toBe(1)

    // Owner ends mid-turn: fire-and-forget cancel + clearSession (epoch bump).
    // The gen-1 turn's `finally` has NOT run yet — its cancel is parked on the
    // pending provider promise.
    socket1.receive(END)
    expect(messagesOfType(socket1, 'summary')).toHaveLength(1)
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // A client reconnects to the SAME-named DO, opens a fresh session, and
    // starts a NEW turn. This is generation 2.
    const socket2 = await openSocket(doInstance, 'user-B')
    createSessionOverWs(socket2)
    socket2.receive(TURN)
    await tick()
    expect(kit.sttCalls()).toBe(2)
    expect(kit.llmTurns).toHaveLength(2)

    // NOW the gen-1 provider promise settles and the stale `finally` runs —
    // LATE, after gen 2 is live. The epoch guard must make it a no-op.
    kit.llmTurns[0].pushDelta('late')
    await tick()
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)

    // (1) The new session's overlap guard is STILL set: an overlapping `turn`
    // is rejected, and no third runTurn ever starts.
    socket2.receive(TURN)
    await tick()
    expect(messagesOfType(socket2, 'error')).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })
    expect(kit.sttCalls()).toBe(2)

    // (2) The new turn is still cancelable by `end`: the stale finally did not
    // null out gen 2's activeTurn, so end's cancel reaches it and the turn
    // unwinds cleanly without settling.
    socket2.receive(END)
    expect(messagesOfType(socket2, 'summary')).toHaveLength(1)
    kit.llmTurns[1].pushDelta('late-2')
    await tick()
    expect(kit.llmTurns[1].finallyRan()).toBe(true)
    expect(kit.llmTurns[1].settled()).toBe(false)
    expect(sawDoneChunk(socket2)).toBe(false)
  })

  it('owner abrupt close mid-turn → reconnect + new turn → stale finally is a no-op', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()

    // Generation 1 parks mid-turn, then the owner socket drops WITHOUT `end`.
    const socket1 = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket1)
    socket1.receive(TURN)
    await tick()
    socket1.disconnect()
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // Reconnect: fresh session + new turn (generation 2).
    const socket2 = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket2)
    socket2.receive(TURN)
    await tick()
    expect(kit.sttCalls()).toBe(2)

    // gen-1's late `finally` runs after gen 2 is live: must be a no-op.
    kit.llmTurns[0].pushDelta('late')
    await tick()
    expect(kit.llmTurns[0].finallyRan()).toBe(true)

    // The new session's guard survived (overlap still rejected, no third turn)
    // and its turn still completes normally afterwards.
    socket2.receive(TURN)
    await tick()
    expect(messagesOfType(socket2, 'error')).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })
    expect(kit.sttCalls()).toBe(2)
    kit.llmTurns[1].finishStream()
    await tick()
    expect(kit.llmTurns[1].settled()).toBe(true)
    expect(sawDoneChunk(socket2)).toBe(true)
  })
})
