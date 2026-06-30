import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression tests for post-`end` (and post-owner-close)
 * session-state cleanup (the P2 from PR #156 review) plus the F-W owner-socket
 * teardown gate, driving the REAL `VoiceSessionDO` under the workerd runtime
 * (`@cloudflare/vitest-pool-workers`).
 *
 * Harness (see `session-do-test-kit.ts`): the genuine Cloudflare Durable Object,
 * driven over a real client WebSocket. Tests that must park a turn mid-flight
 * install the gated provider bundle at the `createProviders` seam; the rest run
 * the real `assembleSession` -> `createProviders` path with the credential-free
 * `demo-mock` game. Note a real `1008` close actually closes that client socket,
 * so a follow-up control message after a fail-loud reject opens a fresh socket —
 * exactly as a reconnecting client would.
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
  UUID_RE,
  waitFor,
  waitForMessage,
} from './session-do-test-kit'

beforeEach(() => {
  providerControl.override = undefined
})

const TURN = JSON.stringify({ type: 'turn' })
const END = JSON.stringify({ type: 'end' })

// --- post-end: a create-less turn is rejected --------------------------------

describe('real VoiceSessionDO — post-end cleanup, create-less turn rejected (P2)', () => {
  it('rejects a turn after end with no new create; no provider turn starts', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // Owner ends the session: summary out, clean close, state cleared.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)

    // A reconnect (same user, same-named DO) sends `turn` with NO fresh
    // `create`. The cleared binding fail-louds it — no provider turn runs on
    // the ended session.
    const reconnect = await openSocket(session, 'user-A')
    reconnect.send(TURN)
    await waitFor(
      () => reconnect.closeEvents.some((c) => c.code === 1008),
      'turn-before-create close'
    )
    expect(reconnect.closeEvents).toContainEqual({ code: 1008, reason: 'turn before create' })
    expect(kit.sttCalls()).toBe(0)
  })
})

// --- post-end: a same-name create opens a clean new session ------------------

describe('real VoiceSessionDO — post-end cleanup, create after end opens fresh (P2)', () => {
  it('does not reject the post-end create with already_created; mints a new session', async () => {
    // Real demo-mock provider path — no gating needed here.
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    const firstId = await createSessionOverWs(socket)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)

    // Same user reconnects to the same-named DO and creates again: NOT
    // rejected as already_created — a clean new session with its own UUID.
    const reconnect = await openSocket(session, 'user-A')
    const secondId = await createSessionOverWs(reconnect)

    expect(secondId).toMatch(UUID_RE)
    expect(secondId).not.toBe(firstId)
    expect(messagesOfType(reconnect, 'error')).toEqual([])
  })

  it('still rejects a genuine re-create WHILE a session is live (unchanged behaviour)', async () => {
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // No `end` happened — the session is live, so a second create is rejected.
    socket.send(JSON.stringify({ type: 'create', gameId: 'demo-mock', manualData: {} }))
    await waitForMessage(socket, 'error')
    expect(messagesOfType(socket, 'error')).toContainEqual({
      type: 'error',
      code: 'already_created',
      message: 'session already created',
    })

    // The live session is intact: the owner can still end it normally.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
  })
})

// --- post-end with an in-flight turn: cancel + clear, no resurrection ---------

describe('real VoiceSessionDO — end mid-turn clears, late settle does not revive (P2 + F-J)', () => {
  it('fire-and-forget cancel + clear; the stale unwind leaves the DO cleanly reusable', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    const firstId = await createSessionOverWs(socket)

    await driveUtteranceToLlm(socket, kit, 1)
    await session.run(() => kit.llmTurns[0].pushDelta('partial'))
    await settle()

    // `end` arrives mid-turn: summary lands while the turn is still parked, the
    // cancel is fire-and-forget, and the session state is cleared immediately.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // The parked provider await settles LATE; the canceled turn unwinds
    // without reaching settle.
    await session.run(() => kit.llmTurns[0].pushDelta('late'))
    await waitFor(() => kit.llmTurns[0].finallyRan(), 'turn unwound')
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)
    expect(sawDoneChunk(socket)).toBe(false)

    // The late settle did not revive the session: a create-less turn from a
    // reconnect is still rejected, and no provider turn ran.
    const reconnect = await openSocket(session, 'user-A')
    reconnect.send(TURN)
    await waitFor(
      () => reconnect.closeEvents.some((c) => c.code === 1008),
      'turn-before-create close'
    )
    expect(reconnect.closeEvents).toContainEqual({ code: 1008, reason: 'turn before create' })
    expect(kit.sttCalls()).toBe(1)

    // A fresh create opens a clean new session whose first turn carries NO
    // history from the ended run.
    const reconnect2 = await openSocket(session, 'user-A')
    const secondId = await createSessionOverWs(reconnect2)
    expect(secondId).not.toBe(firstId)
    await driveUtteranceToLlm(reconnect2, kit, 2)
    const freshHistory = kit.llmTurns[1].request.messages.filter((m) => m.role === 'assistant')
    expect(freshHistory).toEqual([])
    await session.run(() => kit.llmTurns[1].finishStream())
    await waitFor(() => sawDoneChunk(reconnect2), 'fresh done chunk')
    expect(sawDoneChunk(reconnect2)).toBe(true)
  })
})

// --- owner abrupt close (no end): same residue, same cleanup -----------------

describe('real VoiceSessionDO — owner abrupt close clears the session like end (P2 audit)', () => {
  it('an owner drop with no end clears state so a reconnect cannot drive the old session', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    const firstId = await createSessionOverWs(socket)

    await driveUtteranceToLlm(socket, kit, 1)
    await session.run(() => kit.llmTurns[0].pushDelta('x'))
    await settle()

    // Owner's socket drops WITHOUT sending `end` (network drop / tab close).
    socket.disconnect()
    await settle()

    // The in-flight turn is cleanly canceled once its provider await settles.
    await session.run(() => kit.llmTurns[0].pushDelta('late'))
    await waitFor(() => kit.llmTurns[0].finallyRan(), 'turn unwound')
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)

    // A reconnect's create-less turn is rejected (no provider turn runs)...
    const reconnect = await openSocket(session, 'user-A')
    reconnect.send(TURN)
    await waitFor(
      () => reconnect.closeEvents.some((c) => c.code === 1008),
      'turn-before-create close'
    )
    expect(reconnect.closeEvents).toContainEqual({ code: 1008, reason: 'turn before create' })
    expect(kit.sttCalls()).toBe(1)

    // ...and a reconnect `create` opens a fresh, fully working session.
    const reconnect2 = await openSocket(session, 'user-A')
    const secondId = await createSessionOverWs(reconnect2)
    expect(secondId).not.toBe(firstId)
    await driveUtteranceToLlm(reconnect2, kit, 2)
    await session.run(() => kit.llmTurns[1].finishStream())
    await waitFor(() => kit.llmTurns[1].settled(), 'fresh turn settled')
    expect(kit.llmTurns[1].settled()).toBe(true)
    await waitFor(() => sawDoneChunk(reconnect2), 'fresh done chunk')
    expect(sawDoneChunk(reconnect2)).toBe(true)
  })
})

// --- F-W: `end` from a same-user NON-OWNER socket must not tear down ----------

describe('real VoiceSessionDO — end teardown gate, only the owner socket ends (F-W)', () => {
  it('a same-user duplicate socket’s end is rejected fail-loud and tears nothing down', async () => {
    const session = makeSessionDo()
    const owner = await openSocket(session, 'user-A')
    await createSessionOverWs(owner)
    // A second socket for the SAME user (duplicate tab / reconnect).
    const duplicate = await openSocket(session, 'user-A')

    duplicate.send(END)
    await waitFor(
      () => duplicate.closeEvents.some((c) => c.code === 1008),
      'duplicate fail-loud close'
    )

    // The duplicate is closed fail-loud; NO summary, NO teardown anywhere.
    expect(duplicate.closeEvents).toContainEqual({
      code: 1008,
      reason: 'end from non-owner socket',
    })
    expect(messagesOfType(duplicate, 'summary')).toEqual([])
    expect(messagesOfType(owner, 'summary')).toEqual([])

    // The original session survived: the OWNER socket can still end normally.
    owner.send(END)
    await waitForMessage(owner, 'summary')
    expect(messagesOfType(owner, 'summary')).toHaveLength(1)
    await waitFor(() => owner.closeEvents.some((c) => c.code === 1000), 'owner clean close')
    expect(owner.closeEvents).toContainEqual({ code: 1000, reason: 'session ended' })
  })

  it('a same-user duplicate socket’s end does not cancel the owner’s in-flight turn', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const owner = await openSocket(session, 'user-A')
    await createSessionOverWs(owner)
    const duplicate = await openSocket(session, 'user-A')

    await driveUtteranceToLlm(owner, kit, 1)
    await session.run(() => kit.llmTurns[0].pushDelta('partial'))
    await settle()

    // The duplicate fires `end` mid-turn: rejected; the in-flight turn keeps
    // running and is NOT canceled.
    duplicate.send(END)
    await waitFor(
      () => duplicate.closeEvents.some((c) => c.code === 1008),
      'duplicate fail-loud close'
    )
    expect(duplicate.closeEvents).toContainEqual({
      code: 1008,
      reason: 'end from non-owner socket',
    })
    expect(kit.llmTurns[0].finallyRan()).toBe(false)

    // The owner's turn still completes and counts.
    await session.run(() => kit.llmTurns[0].finishStream())
    await waitFor(() => kit.llmTurns[0].settled(), 'owner turn settled')
    expect(kit.llmTurns[0].settled()).toBe(true)
    await waitFor(() => sawDoneChunk(owner), 'owner done chunk')
    expect(sawDoneChunk(owner)).toBe(true)
    owner.send(END)
    await waitForMessage(owner, 'summary')
    const summary = messagesOfType(owner, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })
})
