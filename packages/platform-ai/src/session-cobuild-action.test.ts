import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Session-level proof of the co_build channel, driving the REAL `VoiceSessionDO`
 * under workerd. The same fence-emitting LLM is run against a co_build-capable
 * game (`sound-garden`) and a non-co_build game (`demo-mock`):
 *
 *  - co_build: the DO emits ONE `{type:'action'}` frame carrying the parsed moves,
 *    and the fence markers + action JSON are stripped from every text chunk (never
 *    spoken).
 *  - non-co_build (the regression assertion): NO `action` frame is emitted and the
 *    text stream is BYTE-IDENTICAL to the raw model output — the fence flows through
 *    untouched, proving the splitter never runs when a game has no `coBuild`.
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

import type { LlmProvider } from './providers/types'
import {
  createSessionOverWs,
  makeSessionDo,
  makeTurnProviders,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  TestSocket,
  waitFor,
  waitForMessage,
} from './session-do-test-kit'

const OPEN = '<<<ACTIONS>>>'
const CLOSE = '<<<END_ACTIONS>>>'
const ACTION_JSON = '[{"op":"place","piece_type":"kick","slot":1}]'
const SPEECH = '好的，我放个底鼓打底。'
/** The full raw model output (speech + trailing fenced action block). */
const RAW = `${SPEECH}${OPEN}${ACTION_JSON}${CLOSE}`

/** An LLM that speaks, then appends the fenced action block across several deltas. */
function makeFenceLlm(): LlmProvider {
  return {
    async *streamCompletion() {
      yield { content: '好的，', done: false }
      yield { content: '我放个底鼓打底。', done: false }
      yield { content: OPEN, done: false }
      yield { content: ACTION_JSON, done: false }
      yield { content: CLOSE, done: true }
    },
  }
}

const textTurn = (text: string) => JSON.stringify({ type: 'text-turn', text })
const END = JSON.stringify({ type: 'end' })

function joinedText(socket: TestSocket): string {
  return messagesOfType(socket, 'chunk')
    .filter((c) => c.kind === 'text')
    .map((c) => (typeof c.text === 'string' ? c.text : ''))
    .join('')
}

beforeEach(() => {
  providerControl.override = undefined
})

describe('real VoiceSessionDO — co_build action channel', () => {
  it('co_build game: emits ONE action frame and strips the fence from the spoken text', async () => {
    providerControl.override = makeTurnProviders(makeFenceLlm()).providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'sound-garden')

    socket.send(textTurn('放个底鼓吧'))
    await waitFor(() => sawDoneChunk(socket), 'reply done')

    // Exactly one action frame with the parsed move.
    const actionFrames = messagesOfType(socket, 'action')
    expect(actionFrames).toHaveLength(1)
    expect(actionFrames[0].actions).toEqual([{ op: 'place', pieceType: 'kick', slot: 1 }])

    // The spoken text is the speech only — no fence marker, no action JSON.
    const text = joinedText(socket)
    expect(text).toBe(SPEECH)
    expect(text).not.toContain('<<<')
    expect(text).not.toContain('ACTIONS')
    expect(text).not.toContain('piece_type')

    socket.send(END)
    await waitForMessage(socket, 'summary')
  })

  it('non-co_build game: emits NO action frame and the text is byte-identical to the raw output', async () => {
    providerControl.override = makeTurnProviders(makeFenceLlm()).providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket, 'demo-mock')

    socket.send(textTurn('放个底鼓吧'))
    await waitFor(() => sawDoneChunk(socket), 'reply done')

    // No action frame at all — the splitter never runs for a game without coBuild.
    expect(messagesOfType(socket, 'action')).toHaveLength(0)

    // The text stream carries the FULL raw output, fence markers included: the
    // pipeline behaves exactly as before the co_build change.
    expect(joinedText(socket)).toBe(RAW)

    socket.send(END)
    await waitForMessage(socket, 'summary')
  })
})
