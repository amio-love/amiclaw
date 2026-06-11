import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression tests for post-`end` (and post-owner-close)
 * session-state cleanup (the P2 from PR #156 review) plus the F-W owner-socket
 * teardown gate, driving the REAL `VoiceSessionDO` in Node — these replaced the
 * earlier `FakeSessionDo` mirror suite, whose green could not prove the real
 * class still cleared its bound state.
 *
 * Harness (see `session-do-test-kit.ts` and the pattern's SSOT,
 * `session-do-usage-flush.test.ts`): mocked `cloudflare:workers` base, stubbed
 * `WebSocketPair` / `Response` globals, sockets driven through the real `fetch`
 * upgrade. Tests that must park a turn mid-flight install the gated provider
 * bundle at the `createProviders` seam; the rest run the real `assembleSession`
 * -> `createProviders` path with the credential-free `demo-mock` game.
 *
 * The defect's shape: after `end` (or an abrupt owner drop) the DO kept
 * `state` / `userId` / `providers` bound on the resident instance. A later
 * client reconnecting to the SAME-named DO could then (a) be wrongly rejected
 * with `already_created` on `create`, and worse (b) send a `turn` with NO new
 * `create`, pass the stale ownership guard, and run a provider turn on the
 * already-ended session. F-W: `end` teardown is gated on the OWNER SOCKET
 * recorded at `create`, so a same-user duplicate socket cannot tear the
 * still-active session down.
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
  UUID_RE,
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

// --- post-end: a create-less turn is rejected --------------------------------

describe('real VoiceSessionDO — post-end cleanup, create-less turn rejected (P2)', () => {
  it('rejects a turn after end with no new create; no provider turn starts', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    // Owner ends the session: summary out, clean close, state cleared.
    socket.receive(END)
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)

    // A reconnect (same user, same-named DO) sends `turn` with NO fresh
    // `create`. The cleared binding fail-louds it — no provider turn runs on
    // the ended session.
    const reconnect = await openSocket(doInstance, 'user-A')
    reconnect.receive(TURN)
    await tick()
    expect(reconnect.closes).toContainEqual({ code: 1008, reason: 'turn before create' })
    expect(kit.sttCalls()).toBe(0)
  })
})

// --- post-end: a same-name create opens a clean new session ------------------

describe('real VoiceSessionDO — post-end cleanup, create after end opens fresh (P2)', () => {
  it('does not reject the post-end create with already_created; mints a new session', async () => {
    // Real demo-mock provider path — no gating needed here.
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    const firstId = createSessionOverWs(socket)

    socket.receive(END)
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)

    // Same user reconnects to the same-named DO and creates again: NOT
    // rejected as already_created — a clean new session with its own UUID.
    const reconnect = await openSocket(doInstance, 'user-A')
    const secondId = createSessionOverWs(reconnect)

    expect(secondId).toMatch(UUID_RE)
    expect(secondId).not.toBe(firstId)
    expect(messagesOfType(reconnect, 'error')).toEqual([])
  })

  it('still rejects a genuine re-create WHILE a session is live (unchanged behaviour)', async () => {
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    createSessionOverWs(socket)

    // No `end` happened — the session is live, so a second create is rejected.
    socket.receive(JSON.stringify({ type: 'create', gameId: 'demo-mock', manualData: {} }))
    expect(messagesOfType(socket, 'error')).toContainEqual({
      type: 'error',
      code: 'already_created',
      message: 'session already created',
    })

    // The live session is intact: the owner can still end it normally.
    socket.receive(END)
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
  })
})

// --- post-end with an in-flight turn: cancel + clear, no resurrection ---------

describe('real VoiceSessionDO — end mid-turn clears, late settle does not revive (P2 + F-J)', () => {
  it('fire-and-forget cancel + clear; the stale unwind leaves the DO cleanly reusable', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    const firstId = createSessionOverWs(socket)

    socket.receive(TURN)
    await tick()
    kit.llmTurns[0].pushDelta('partial')
    await tick()

    // `end` arrives mid-turn: summary lands synchronously, the cancel is
    // fire-and-forget, and the session state is cleared immediately.
    socket.receive(END)
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // The parked provider await settles LATE; the canceled turn unwinds
    // without reaching settle.
    kit.llmTurns[0].pushDelta('late')
    await tick()
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)
    expect(sawDoneChunk(socket)).toBe(false)

    // The late settle did not revive the session: a create-less turn from a
    // reconnect is still rejected, and no provider turn ran.
    const reconnect = await openSocket(doInstance, 'user-A')
    reconnect.receive(TURN)
    await tick()
    expect(reconnect.closes).toContainEqual({ code: 1008, reason: 'turn before create' })
    expect(kit.sttCalls()).toBe(1)

    // A fresh create opens a clean new session whose first turn carries NO
    // history from the ended run.
    const secondId = createSessionOverWs(reconnect)
    expect(secondId).not.toBe(firstId)
    reconnect.receive(TURN)
    await tick()
    expect(kit.sttCalls()).toBe(2)
    const freshHistory = kit.llmTurns[1].request.messages.filter((m) => m.role === 'assistant')
    expect(freshHistory).toEqual([])
    kit.llmTurns[1].finishStream()
    await tick()
    expect(sawDoneChunk(reconnect)).toBe(true)
  })
})

// --- owner abrupt close (no end): same residue, same cleanup -----------------

describe('real VoiceSessionDO — owner abrupt close clears the session like end (P2 audit)', () => {
  it('an owner drop with no end clears state so a reconnect cannot drive the old session', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const socket = await openSocket(doInstance, 'user-A')
    const firstId = createSessionOverWs(socket)

    socket.receive(TURN)
    await tick()
    kit.llmTurns[0].pushDelta('x')
    await tick()

    // Owner's socket drops WITHOUT sending `end` (network drop / tab close).
    socket.disconnect()

    // The in-flight turn is cleanly canceled once its provider await settles.
    kit.llmTurns[0].pushDelta('late')
    await tick()
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)

    // A reconnect's create-less turn is rejected (no provider turn runs)...
    const reconnect = await openSocket(doInstance, 'user-A')
    reconnect.receive(TURN)
    await tick()
    expect(reconnect.closes).toContainEqual({ code: 1008, reason: 'turn before create' })
    expect(kit.sttCalls()).toBe(1)

    // ...and a reconnect `create` opens a fresh, fully working session.
    const secondId = createSessionOverWs(reconnect)
    expect(secondId).not.toBe(firstId)
    reconnect.receive(TURN)
    await tick()
    expect(kit.sttCalls()).toBe(2)
    kit.llmTurns[1].finishStream()
    await tick()
    expect(kit.llmTurns[1].settled()).toBe(true)
    expect(sawDoneChunk(reconnect)).toBe(true)
  })
})

// --- F-W: `end` from a same-user NON-OWNER socket must not tear down ----------

describe('real VoiceSessionDO — end teardown gate, only the owner socket ends (F-W)', () => {
  it('a same-user duplicate socket’s end is rejected fail-loud and tears nothing down', async () => {
    const { doInstance } = makeSessionDo()
    const owner = await openSocket(doInstance, 'user-A')
    createSessionOverWs(owner)
    // A second socket for the SAME user (duplicate tab / reconnect).
    const duplicate = await openSocket(doInstance, 'user-A')

    duplicate.receive(END)
    await tick()

    // The duplicate is closed fail-loud; NO summary, NO teardown anywhere.
    expect(duplicate.closes).toContainEqual({ code: 1008, reason: 'end from non-owner socket' })
    expect(messagesOfType(duplicate, 'summary')).toEqual([])
    expect(messagesOfType(owner, 'summary')).toEqual([])

    // The original session survived: the OWNER socket can still end normally.
    owner.receive(END)
    expect(messagesOfType(owner, 'summary')).toHaveLength(1)
    expect(owner.closes).toContainEqual({ code: 1000, reason: 'session ended' })
  })

  it('a same-user duplicate socket’s end does not cancel the owner’s in-flight turn', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const { doInstance } = makeSessionDo()
    const owner = await openSocket(doInstance, 'user-A')
    createSessionOverWs(owner)
    const duplicate = await openSocket(doInstance, 'user-A')

    owner.receive(TURN)
    await tick()
    kit.llmTurns[0].pushDelta('partial')
    await tick()

    // The duplicate fires `end` mid-turn: rejected; the in-flight turn keeps
    // running and is NOT canceled.
    duplicate.receive(END)
    await tick()
    expect(duplicate.closes).toContainEqual({ code: 1008, reason: 'end from non-owner socket' })
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // The owner's turn still completes and counts.
    kit.llmTurns[0].finishStream()
    await tick()
    expect(kit.llmTurns[0].settled()).toBe(true)
    expect(sawDoneChunk(owner)).toBe(true)
    owner.receive(END)
    const summary = messagesOfType(owner, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })
})
