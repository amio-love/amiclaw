import { describe, expect, it } from 'vitest'

/**
 * Production-class tests for the AI-first opening greeting on the REAL
 * `VoiceSessionDO` under the workerd runtime (`@cloudflare/vitest-pool-workers`).
 *
 * Right after `create`, the DO runs an opening greeting turn (LLM->TTS, NO
 * player audio) from the server-side opening directive — the AI speaks first.
 * Turn detection itself lives on the client (its VAD sends a `turn` message);
 * the per-turn STT->LLM->TTS path is covered by the turn-guard / pipeline suites.
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

describe('real VoiceSessionDO — AI-first opening greeting', () => {
  it('streams an unprompted greeting turn right after create, with no player audio', async () => {
    // Real demo-mock providers: the mock LLM greets, the mock TTS synthesizes —
    // no player audio, no `turn` message.
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock', { opening: true })

    // The greeting streams text + audio and completes with a terminal done chunk,
    // purely from the server-side opening directive.
    await waitFor(() => sawDoneChunk(socket), 'opening greeting completed')
    const textChunks = messagesOfType(socket, 'chunk').filter(
      (c) => c.kind === 'text' && c.text !== ''
    )
    expect(textChunks.length).toBeGreaterThan(0)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    // The opening greeting is not a player turn — turnCount stays 0.
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)
  })

  it('suppresses the greeting when opening is false (no chunks stream after create)', async () => {
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock', { opening: false })
    await settle()

    expect(messagesOfType(socket, 'chunk')).toEqual([])
    expect(sawDoneChunk(socket)).toBe(false)
  })
})
