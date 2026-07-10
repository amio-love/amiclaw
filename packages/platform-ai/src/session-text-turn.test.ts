import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for the additive `text-turn` message (FP1 text fallback, probe branch),
 * driving the REAL `VoiceSessionDO` under workerd (`@cloudflare/vitest-pool-workers`).
 * A `text-turn` feeds typed text directly to the LLM (skipping STT) and reuses the
 * voice reply path (`runReply`) — so it must: echo the typed text as the terminal
 * transcript, stream a reply, count exactly one turn, and cost zero STT; no-op on
 * empty text; work with no prior `speech-start`; fail loud with no live session;
 * and reject mid-flight (serial). Existing message flows are untouched.
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
  makeInspectingProviders,
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

const textTurn = (text: string) => JSON.stringify({ type: 'text-turn', text })
const END = JSON.stringify({ type: 'end' })

describe('real VoiceSessionDO — text-turn (FP1 text fallback)', () => {
  it('feeds typed text directly to the LLM (skips STT), echoes it, and replies', async () => {
    providerControl.override = makeInspectingProviders().providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    socket.send(textTurn('兰花怎么养护'))
    await waitFor(() => sawDoneChunk(socket), 'reply done')

    // The typed text is echoed as the terminal transcript (final: true).
    const transcripts = messagesOfType(socket, 'transcript')
    expect(transcripts.some((t) => t.text === '兰花怎么养护' && t.final === true)).toBe(true)
    // A real AI reply streamed.
    const textChunks = messagesOfType(socket, 'chunk').filter((c) => c.kind === 'text')
    expect(textChunks.length).toBeGreaterThan(0)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as {
      turnCount: number
      usage: { sttInputSeconds: number }
    }
    // Exactly one turn, and STT cost is zero (STT was skipped entirely).
    expect(summary.turnCount).toBe(1)
    expect(summary.usage.sttInputSeconds).toBe(0)
  })

  it('needs no prior speech-start (typed input bypasses the utterance path)', async () => {
    providerControl.override = makeInspectingProviders().providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // No speech-start; a text-turn still produces a reply.
    socket.send(textTurn('遮光一次可以吗'))
    await waitFor(() => sawDoneChunk(socket), 'reply done without speech-start')
    expect(sawDoneChunk(socket)).toBe(true)
  })

  it('empty / whitespace text is a benign no-op (no reply, no turn counted)', async () => {
    providerControl.override = makeInspectingProviders().providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    socket.send(textTurn('   '))
    await settle()
    expect(sawDoneChunk(socket)).toBe(false)
    expect(messagesOfType(socket, 'chunk')).toEqual([])

    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(0)
  })

  it('text-turn before create fail-louds with 1008 (no live session)', async () => {
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    // No create.
    socket.send(textTurn('在吗'))
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1008), '1008 close')
    expect(socket.closeEvents.some((c) => c.code === 1008)).toBe(true)
  })

  it('text-turn after end is impossible: session torn down, socket closed', async () => {
    providerControl.override = makeInspectingProviders().providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean close')

    // The socket is closed on end, so a text-turn cannot be delivered — the
    // transport rejects the send. No reply can be produced post-end.
    expect(() => socket.send(textTurn('还在吗'))).toThrow()
    await settle()
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
  })

  it('a text-turn while a turn is in flight is rejected (serial turns)', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // A voice turn parks at the gated LLM.
    await driveUtteranceToLlm(socket, kit, 1)
    // A text-turn arrives mid-reply.
    socket.send(textTurn('插一句'))
    await waitForMessage(socket, 'error')
    expect(messagesOfType(socket, 'error')).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })

    // The first turn still completes normally.
    await session.run(() => kit.llmTurns[0].finishStream())
    await waitFor(() => sawDoneChunk(socket), 'first turn done')
    expect(sawDoneChunk(socket)).toBe(true)
  })
})
