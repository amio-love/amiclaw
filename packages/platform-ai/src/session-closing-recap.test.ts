import { describe, expect, it } from 'vitest'

/**
 * Production-class tests for the closing-recap turn on the REAL `VoiceSessionDO`
 * under the workerd runtime (`@cloudflare/vitest-pool-workers`).
 *
 * After the player's bomb is defused the client sends `{ type: 'closing' }`. The
 * DO runs one AI-only turn (LLM->TTS, NO player audio — mirrors the opening
 * greeting) to deliver a short spoken recap. This suite covers:
 *   - The closing turn streams text + audio and completes (done chunk arrives).
 *   - turnCount is NOT incremented (closing is not a player turn).
 *   - `end` works cleanly after the closing turn finishes.
 *   - Sending `closing` before `create` is a silent no-op (no chunks emitted).
 *
 * Harness details: see `session-do-test-kit.ts`.
 */

import {
  createSessionOverWs,
  makeSessionDo,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  settle,
  waitFor,
  waitForMessage,
} from './session-do-test-kit'

const END = JSON.stringify({ type: 'end' })
const CLOSING = JSON.stringify({ type: 'closing' })
const CLOSING_EXPLODED = JSON.stringify({ type: 'closing', outcome: 'exploded' })
const CLOSING_TIMEOUT = JSON.stringify({ type: 'closing', outcome: 'timeout' })

describe('real VoiceSessionDO — closing recap turn', () => {
  it('streams a complete reply turn after a `closing` control message', async () => {
    // Real demo-mock providers: the mock LLM replies, the mock TTS synthesizes —
    // no player audio, just the server-side closing directive.
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock', { opening: false })

    socket.send(CLOSING)

    await waitFor(() => sawDoneChunk(socket), 'closing recap completed')
    const textChunks = messagesOfType(socket, 'chunk').filter(
      (c) => c.kind === 'text' && c.text !== ''
    )
    expect(textChunks.length).toBeGreaterThan(0)
  })

  it('streams a complete recap for an `exploded` outcome (failure register)', async () => {
    // Outcome-aware closing: an `exploded` recap runs the failure directive and
    // still streams a complete LLM+TTS turn (the register is the LLM's concern;
    // the DO path is outcome-agnostic beyond selecting the directive).
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock', { opening: false })

    socket.send(CLOSING_EXPLODED)

    await waitFor(() => sawDoneChunk(socket), 'exploded recap completed')
    const textChunks = messagesOfType(socket, 'chunk').filter(
      (c) => c.kind === 'text' && c.text !== ''
    )
    expect(textChunks.length).toBeGreaterThan(0)
  })

  it('streams a complete recap for a `timeout` outcome', async () => {
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock', { opening: false })

    socket.send(CLOSING_TIMEOUT)

    await waitFor(() => sawDoneChunk(socket), 'timeout recap completed')
    expect(messagesOfType(socket, 'chunk').some((c) => c.kind === 'text' && c.text !== '')).toBe(
      true
    )
  })

  it('does not increment turnCount on closing recap', async () => {
    // The closing turn is an AI-only epilogue, not a player turn. turnCount
    // in the summary must stay at 0 regardless of how many closing turns run.
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock', { opening: false })

    socket.send(CLOSING)
    await waitFor(() => sawDoneChunk(socket), 'closing recap completed')

    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)
  })

  it('accepts `end` cleanly after closing recap completes', async () => {
    // The DO must still handle `end` after a closing turn without crashing or
    // hanging — session teardown must be clean.
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock', { opening: false })

    socket.send(CLOSING)
    await waitFor(() => sawDoneChunk(socket), 'closing recap done before end')

    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary').length).toBeGreaterThan(0)
  })

  it('is a no-op (no chunks) if sent before `create`', async () => {
    // If the client misbehaves and sends `closing` before the session is
    // initialised, the DO must silently ignore it rather than crash.
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    // Deliberately skip `create` — sessionState is null.

    socket.send(CLOSING)
    await settle()

    expect(messagesOfType(socket, 'chunk')).toEqual([])
    expect(sawDoneChunk(socket)).toBe(false)
  })
})
