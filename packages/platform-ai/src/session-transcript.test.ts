import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression test for the player-transcript wire frame, driving
 * the REAL `VoiceSessionDO` turn relay under the workerd runtime
 * (`@cloudflare/vitest-pool-workers`).
 *
 * The DO must surface the player's recognized speech back to the client so the
 * UI can show a subtitle of what the AI heard. After a turn's STT produces the
 * final transcript and BEFORE the AI reply chunks stream, the DO sends one
 * `{type:'transcript', text}` JSON frame (NOT a `chunk`). A benign no-speech
 * turn (STT closes with no final transcript) sends none — consistent with the
 * no-speech skip. The opening greeting carries no player transcript and sends
 * none either (covered by `runOpeningTurn` never yielding a transcript chunk).
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
  makeInspectingProviders,
  makeNoSpeechProviders,
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

describe('real VoiceSessionDO — player transcript wire frame', () => {
  it('sends {type:transcript, text} once, before the AI reply chunks', async () => {
    const kit = makeInspectingProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    socket.send(TURN)
    await waitFor(() => kit.sttCalls() === 1, 'turn ran STT once')
    await waitFor(() => sawDoneChunk(socket), 'turn emitted its terminal done chunk')

    // Exactly one transcript frame, carrying the player's recognized utterance
    // (the inspecting STT's fixed final transcript) — its OWN frame, NOT a
    // `chunk`, and with no `done` key.
    const transcripts = messagesOfType(socket, 'transcript')
    expect(transcripts).toEqual([{ type: 'transcript', text: 'inspecting harness utterance' }])

    // Ordering: the transcript frame arrives BEFORE the first AI reply chunk.
    const transcriptIndex = socket.messages.findIndex((m) => m.type === 'transcript')
    const firstChunkIndex = socket.messages.findIndex((m) => m.type === 'chunk')
    expect(transcriptIndex).toBeGreaterThanOrEqual(0)
    expect(firstChunkIndex).toBeGreaterThanOrEqual(0)
    expect(transcriptIndex).toBeLessThan(firstChunkIndex)

    // The AI reply chunks are unchanged: text/audio chunks still stream and end
    // with exactly one terminal done chunk.
    expect(sawDoneChunk(socket)).toBe(true)
    const chunks = messagesOfType(socket, 'chunk')
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.filter((c) => c.done === true)).toHaveLength(1)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
  })

  it('sends NO transcript frame on a benign no-speech turn', async () => {
    const kit = makeNoSpeechProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    socket.send(TURN)
    await waitFor(() => kit.sttCalls() === 1, 'turn ran STT once')
    // The no-speech skip emits nothing; let any (absent) frames drain so the
    // "nothing was sent" assertion is meaningful.
    await settle()

    // No transcript frame, no AI reply chunks — the turn skipped benignly, and
    // the LLM was never reached.
    expect(messagesOfType(socket, 'transcript')).toEqual([])
    expect(messagesOfType(socket, 'chunk')).toEqual([])
    expect(kit.llmCalls()).toBe(0)
    expect(socket.closeEvents).toEqual([])

    // The session stays usable: end still summarizes cleanly with zero turns.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)
  })
})
