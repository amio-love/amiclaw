import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression tests for the session-generation EPOCH guard
 * (the P2 from PR #156 review, raised by the prior `clearSession` fix), driving
 * the REAL `VoiceSessionDO` under the workerd runtime
 * (`@cloudflare/vitest-pool-workers`).
 *
 * Harness (see `session-do-test-kit.ts`): the genuine Cloudflare Durable Object,
 * driven over a real client WebSocket, with the gated provider bundle installed
 * at the `createProviders` seam so each generation's turn parks at a genuinely
 * pending provider `await`. Releasing a parked turn happens inside the DO's I/O
 * context (`handle.run(...)`).
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
  driveUtteranceToLlm,
  makeGatedProviders,
  makeSessionDo,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  settle,
  waitFor,
  waitForMessage,
} from './session-do-test-kit'

beforeEach(() => {
  providerControl.override = undefined
})

const TURN = JSON.stringify({ type: 'turn' })
const END = JSON.stringify({ type: 'end' })

// --- the cross-generation race: stale finally must NOT clobber the new session --

describe('real VoiceSessionDO — epoch guard, stale finally is a no-op (P2)', () => {
  it('end mid-turn → reconnect create + new turn → stale finally settles late and is a no-op', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()

    // Generation 1: an owner session with a turn parked at a provider await.
    const socket1 = await openSocket(session, 'user-A')
    await createSessionOverWs(socket1)
    await driveUtteranceToLlm(socket1, kit, 1)
    expect(kit.sttCalls()).toBe(1)

    // Owner ends mid-turn: fire-and-forget cancel + clearSession (epoch bump).
    // The gen-1 turn's `finally` has NOT run yet — its cancel is parked on the
    // pending provider promise.
    socket1.send(END)
    await waitForMessage(socket1, 'summary')
    expect(messagesOfType(socket1, 'summary')).toHaveLength(1)
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // A client reconnects to the SAME-named DO, opens a fresh session, and
    // starts a NEW turn. This is generation 2.
    const socket2 = await openSocket(session, 'user-B')
    await createSessionOverWs(socket2)
    await driveUtteranceToLlm(socket2, kit, 2)
    expect(kit.sttCalls()).toBe(2)
    expect(kit.llmTurns).toHaveLength(2)

    // NOW the gen-1 provider promise settles and the stale `finally` runs —
    // LATE, after gen 2 is live. The epoch guard must make it a no-op.
    await session.run(() => kit.llmTurns[0].pushDelta('late'))
    await waitFor(() => kit.llmTurns[0].finallyRan(), 'gen-1 stale finally ran')
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)

    // (1) The new session's overlap guard is STILL set: an overlapping `turn`
    // is rejected, and no third runTurn ever starts.
    socket2.send(TURN)
    await waitForMessage(socket2, 'error')
    expect(messagesOfType(socket2, 'error')).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })
    expect(kit.sttCalls()).toBe(2)

    // (2) The new turn is still cancelable by `end`: the stale finally did not
    // null out gen 2's activeTurn, so end's cancel reaches it and the turn
    // unwinds cleanly without settling.
    socket2.send(END)
    await waitForMessage(socket2, 'summary')
    expect(messagesOfType(socket2, 'summary')).toHaveLength(1)
    await session.run(() => kit.llmTurns[1].pushDelta('late-2'))
    await waitFor(() => kit.llmTurns[1].finallyRan(), 'gen-2 turn unwound')
    expect(kit.llmTurns[1].finallyRan()).toBe(true)
    expect(kit.llmTurns[1].settled()).toBe(false)
    expect(sawDoneChunk(socket2)).toBe(false)
  })

  it('owner abrupt close mid-turn → reconnect + new turn → stale finally is a no-op', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()

    // Generation 1 parks mid-turn, then the owner socket drops WITHOUT `end`.
    const socket1 = await openSocket(session, 'user-A')
    await createSessionOverWs(socket1)
    await driveUtteranceToLlm(socket1, kit, 1)
    socket1.disconnect()
    await settle()
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // Reconnect: fresh session + new turn (generation 2).
    const socket2 = await openSocket(session, 'user-A')
    await createSessionOverWs(socket2)
    await driveUtteranceToLlm(socket2, kit, 2)
    expect(kit.sttCalls()).toBe(2)

    // gen-1's late `finally` runs after gen 2 is live: must be a no-op.
    await session.run(() => kit.llmTurns[0].pushDelta('late'))
    await waitFor(() => kit.llmTurns[0].finallyRan(), 'gen-1 stale finally ran')
    expect(kit.llmTurns[0].finallyRan()).toBe(true)

    // The new session's guard survived (overlap still rejected, no third turn)
    // and its turn still completes normally afterwards.
    socket2.send(TURN)
    await waitForMessage(socket2, 'error')
    expect(messagesOfType(socket2, 'error')).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })
    expect(kit.sttCalls()).toBe(2)
    await session.run(() => kit.llmTurns[1].finishStream())
    await waitFor(() => kit.llmTurns[1].settled(), 'gen-2 turn settled')
    expect(kit.llmTurns[1].settled()).toBe(true)
    await waitFor(() => sawDoneChunk(socket2), 'gen-2 done chunk')
    expect(sawDoneChunk(socket2)).toBe(true)
  })
})
