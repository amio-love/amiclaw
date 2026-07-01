import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression tests for the turn in-flight guard and the DO
 * cross-await reentrancy matrix (the P1 from PR #156 review), driving the REAL
 * `VoiceSessionDO` under the workerd runtime (`@cloudflare/vitest-pool-workers`).
 *
 * Harness (see `session-do-test-kit.ts`): the DO is the genuine Cloudflare
 * Durable Object, instantiated through the `VOICE_SESSION` binding and driven
 * over a REAL client WebSocket; `cloudflare:workers` is NOT mocked. Turn parking
 * is real: `createProviders` is passed through except when a test installs the
 * gated provider bundle, whose LLM stream suspends `runTurn` at a genuinely
 * pending provider `await` — exactly the cross-await window an interleaved
 * control message arrives in. Releasing a parked turn happens INSIDE the DO's
 * I/O context (`handle.run(...)`), so the resumed `server.send` is in-context.
 * The defect's shape: a second `turn` mid-flight would start a second `runTurn`
 * over the same `state`/`providers`/socket, racing shared `history`/`usage` and
 * interleaving two response streams; `end` / owner-close must instead cancel
 * cleanly.
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
  makeStuckLlm,
  makeThrowingLlm,
  makeTurnProviders,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  settle,
  SPEECH_START,
  waitFor,
  waitForMessage,
} from './session-do-test-kit'

beforeEach(() => {
  providerControl.override = undefined
})

const TURN = JSON.stringify({ type: 'turn' })
const END = JSON.stringify({ type: 'end' })

// --- the in-flight turn guard ------------------------------------------------

describe('real VoiceSessionDO — turn in-flight guard (P1)', () => {
  it('rejects a second turn while the first is in flight; no second runTurn starts', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // First utterance: speech-start opens STT, turn finalizes -> the reply parks
    // at the gated LLM await (a real reply mid-flight).
    await driveUtteranceToLlm(socket, kit, 1)
    expect(kit.sttCalls()).toBe(1)
    expect(kit.llmTurns).toHaveLength(1)

    // Owner double-clicks: a second `turn` arrives while the first reply is parked.
    socket.send(TURN)
    await waitForMessage(socket, 'error')

    // Rejected with an explicit signal — NOT a second runTurn, NOT a socket close.
    expect(messagesOfType(socket, 'error')).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })
    expect(kit.sttCalls()).toBe(1)
    expect(socket.closeEvents).toEqual([])

    // The first turn still completes normally — no concurrent pollution.
    await session.run(() => kit.llmTurns[0].pushDelta('The first wire is safe.'))
    await session.run(() => kit.llmTurns[0].finishStream())
    await waitFor(() => kit.llmTurns[0].settled(), 'first turn settled')
    expect(kit.llmTurns[0].settled()).toBe(true)
    await waitFor(() => sawDoneChunk(socket), 'done chunk')
    expect(sawDoneChunk(socket)).toBe(true)

    // Exactly one turn counted in the summary.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })

  it('clears the guard after a turn so a subsequent turn runs normally', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    await driveUtteranceToLlm(socket, kit, 1)
    await session.run(() => kit.llmTurns[0].finishStream())
    await waitFor(() => kit.llmTurns[0].settled(), 'first reply settled')
    expect(kit.llmTurns[0].settled()).toBe(true)

    // A fresh utterance after the first completes is accepted (a real second reply).
    await driveUtteranceToLlm(socket, kit, 2)
    expect(kit.sttCalls()).toBe(2)
    expect(kit.llmTurns).toHaveLength(2)
    await session.run(() => kit.llmTurns[1].finishStream())
    await waitFor(() => kit.llmTurns[1].settled(), 'second turn settled')
    expect(kit.llmTurns[1].settled()).toBe(true)
    expect(messagesOfType(socket, 'error')).toEqual([])

    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(2)
  })

  it('clears the guard even when the turn throws (exception cannot wedge it shut)', async () => {
    const throwing = makeThrowingLlm('provider boom')
    const bundle = makeTurnProviders(throwing.llm)
    providerControl.override = bundle.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // The provider rejects at the LLM step; the listener fail-louds with 1008.
    // Under the real runtime that 1008 close of the OWNER socket also tears the
    // session down (`onSocketClose`) — so proving the guard is not wedged uses a
    // fresh session, exactly as a reconnecting client would.
    socket.send(SPEECH_START)
    socket.send(TURN)
    await waitFor(() => throwing.calls() === 1, 'provider reached once')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1008), '1008 fail-loud close')
    expect(throwing.calls()).toBe(1)
    expect(socket.closeEvents).toContainEqual({ code: 1008, reason: 'provider boom' })

    // The guard is released despite the throw: a fresh session's turn REACHES the
    // provider again instead of bouncing off a wedged turn_in_flight guard.
    const reconnect = await openSocket(session, 'user-A')
    await createSessionOverWs(reconnect)
    reconnect.send(SPEECH_START)
    reconnect.send(TURN)
    await waitFor(() => throwing.calls() === 2, 'provider reached again (guard released)')
    expect(throwing.calls()).toBe(2)
    expect(messagesOfType(reconnect, 'error').filter((m) => m.code === 'turn_in_flight')).toEqual(
      []
    )
  })
})

// --- end during a turn cleanly cancels ---------------------------------------

describe('real VoiceSessionDO — end during a turn (matrix: end)', () => {
  it('cancels the in-flight turn: immediate summary, clean unwind, no settle', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    await driveUtteranceToLlm(socket, kit, 1)
    // Let one chunk through so the turn is genuinely mid-stream.
    await session.run(() => kit.llmTurns[0].pushDelta('partial'))
    await settle()
    expect(kit.llmTurns[0].settled()).toBe(false)

    // `end` arrives mid-turn: the summary + clean close land while the turn is
    // still parked at the provider await — proving `end` never blocks on the
    // fire-and-forget cancel's unwind.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    expect(kit.llmTurns[0].finallyRan()).toBe(false)
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean 1000 close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'session ended' })
    // The canceled turn never settles, so it does not count.
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)

    // The parked provider await then settles; the queued cancel unwinds the
    // turn (provider `finally` ran, streams returned) WITHOUT reaching settle.
    await session.run(() => kit.llmTurns[0].pushDelta('late'))
    await waitFor(() => kit.llmTurns[0].finallyRan(), 'turn unwound')
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)
    expect(sawDoneChunk(socket)).toBe(false)
  })

  it('end with no turn in flight is a no-op cancel and still summarizes', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    socket.send(END)
    await waitForMessage(socket, 'summary')

    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'session ended' })
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
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    socket.send(SPEECH_START)
    socket.send(TURN)
    await waitFor(() => bundle.sttCalls() === 1, 'utterance opened STT')
    // Let the reply reach (and park at) the never-settling stuck LLM.
    await settle()

    // `end` lands even though the reply's cancel can never settle.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'session ended' })

    // The stuck turn's `finally` never ran (the provider await is still
    // pending) — proving `end` did not block on the cancel.
    await settle()
    expect(stuck.finallyRan()).toBe(false)
  })
})

// --- create during a turn is rejected ----------------------------------------

describe('real VoiceSessionDO — create during a turn (matrix: create)', () => {
  it('rejects a re-create and leaves the in-flight session + turn untouched', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    await driveUtteranceToLlm(socket, kit, 1)

    // A second `create` arrives mid-turn: explicit reject, no socket close (a
    // close would truncate the turn streaming on this same socket).
    socket.send(JSON.stringify({ type: 'create', gameId: 'demo-mock', manualData: {} }))
    await waitForMessage(socket, 'error')
    expect(messagesOfType(socket, 'error')).toContainEqual({
      type: 'error',
      code: 'already_created',
      message: 'session already created',
    })
    expect(socket.closeEvents).toEqual([])

    // The live session was not clobbered: the same turn completes and the
    // summary still carries the ORIGINAL session id.
    await session.run(() => kit.llmTurns[0].finishStream())
    await waitFor(() => kit.llmTurns[0].settled(), 'turn settled')
    expect(kit.llmTurns[0].settled()).toBe(true)
    await waitFor(() => sawDoneChunk(socket), 'done chunk')
    expect(sawDoneChunk(socket)).toBe(true)
    socket.send(END)
    await waitForMessage(socket, 'summary')
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
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    await driveUtteranceToLlm(socket, kit, 1)
    await session.run(() => kit.llmTurns[0].pushDelta('x'))
    await settle()

    // Owner's socket drops mid-turn (network drop / tab close).
    socket.disconnect()

    // The parked provider await settles later; the queued cancel unwinds the
    // turn cleanly — provider `finally` ran, settle never reached.
    await session.run(() => kit.llmTurns[0].pushDelta('late'))
    await waitFor(() => kit.llmTurns[0].finallyRan(), 'turn unwound')
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)
    expect(sawDoneChunk(socket)).toBe(false)
  })
})
