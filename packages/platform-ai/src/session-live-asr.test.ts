import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class tests for the LIVE, per-utterance ASR path on the REAL
 * `VoiceSessionDO` under the workerd runtime (`@cloudflare/vitest-pool-workers`).
 *
 * The live model (the fix this suite covers): the client VAD sends
 * `{type:'speech-start'}` when the player begins talking; the DO OPENS a 火山
 * recognizer and feeds the live incoming audio frames to it immediately, streaming
 * `{type:'transcript', final:false}` caption frames back WHILE the player speaks.
 * On `{type:'turn'}` the DO closes the bridge (the ASR pump sends the
 * negative-sequence end-of-audio packet), emits the terminal
 * `{type:'transcript', final:true}` frame, then runs the LLM+TTS reply. A genuine
 * ASR fault fails loud (1008); a barge-in (`speech-start` while the AI is replying)
 * cancels the in-flight reply and opens a fresh utterance.
 *
 * Harness limits (load-bearing): the STT here is MOCKED, so it proves the DO's
 * speech-start -> live-feed -> interim-stream -> turn-finalize WIRING, not the real
 * 火山 streaming / last-package finalization / 8s-timeout behaviour. The manager
 * must LIVE-VERIFY those against the real adapter (speech-start -> stream a fixture
 * -> turn; assert interim frames DURING the utterance, a full final, and that the
 * `[Timeout waiting next packet] ... 8 seconds` fault no longer fires).
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

import { PREROLL_MAX_BYTES } from './session-do'
import {
  createSessionOverWs,
  driveUtteranceToLlm,
  makeErroringAsrProviders,
  makeGatedProviders,
  makeInspectingProviders,
  makeLiveStreamingAsrProviders,
  makeSessionDo,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  settle,
  SPEECH_START,
  TURN,
  waitFor,
  waitForMessage,
} from './session-do-test-kit'

beforeEach(() => {
  providerControl.override = undefined
})

const END = JSON.stringify({ type: 'end' })

describe('real VoiceSessionDO — live per-utterance ASR', () => {
  it('opens the recognizer on speech-start and streams interim caption frames as audio arrives, before turn', async () => {
    const kit = makeLiveStreamingAsrProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // speech-start OPENS the live recognizer — no `turn` yet.
    socket.send(SPEECH_START)
    await waitFor(() => kit.sttCalls() === 1, 'recognizer opened on speech-start')

    // Audio frames stream WHILE the player speaks; each yields a live interim
    // caption frame BEFORE any `turn` is sent.
    socket.send(new Uint8Array([1, 2, 3]).buffer)
    socket.send(new Uint8Array([4, 5]).buffer)
    await waitFor(
      () => messagesOfType(socket, 'transcript').length >= 2,
      'interim caption frames streamed during speech'
    )

    const duringSpeech = messagesOfType(socket, 'transcript')
    expect(duringSpeech.length).toBeGreaterThanOrEqual(2)
    // All caption frames so far are interim (final:false) — the utterance is still
    // open. No AI reply chunk and no terminal transcript before `turn`.
    expect(duringSpeech.every((t) => t.final === false)).toBe(true)
    expect(duringSpeech.some((t) => t.final === true)).toBe(false)
    expect(messagesOfType(socket, 'chunk')).toEqual([])

    // `turn` finalizes: exactly one terminal final transcript frame, then the reply.
    socket.send(TURN)
    await waitFor(() => sawDoneChunk(socket), 'reply completed after turn')
    const finals = messagesOfType(socket, 'transcript').filter((t) => t.final === true)
    expect(finals).toHaveLength(1)
    expect(messagesOfType(socket, 'chunk').length).toBeGreaterThan(0)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })

  it('fails loud (1008) on a real ASR error during the utterance, never a benign skip', async () => {
    const kit = makeErroringAsrProviders('Volcengine ASR error: boom')
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // The recognizer yields one interim then throws a genuine ASR fault — the DO
    // must fail loud with a 1008 close (NOT a benign skip), even before `turn`.
    socket.send(SPEECH_START)
    await waitFor(
      () => socket.closeEvents.some((c) => c.code === 1008),
      'live ASR fault closed the socket 1008'
    )
    expect(socket.closeEvents).toContainEqual({ code: 1008, reason: 'Volcengine ASR error: boom' })
    // The fault is upstream of the reply, so the LLM is never reached.
    expect(kit.llmCalls()).toBe(0)
  })

  it('a barge-in speech-start cancels the in-flight reply and opens a fresh utterance', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // Utterance 1: its reply parks mid-stream at the gated LLM (the AI is talking).
    await driveUtteranceToLlm(socket, kit, 1)
    await session.run(() => kit.llmTurns[0].pushDelta('the AI is talking'))
    await settle()
    expect(kit.llmTurns[0].settled()).toBe(false)

    // The player talks over the AI: a barge-in `speech-start` OPENS a fresh
    // recognizer and cancels the in-flight reply (freeing the serial guard).
    socket.send(SPEECH_START)
    await waitFor(() => kit.sttCalls() === 2, 'barge-in opened a fresh recognizer')

    // The barged-in reply unwinds (its `finally` runs once its parked provider
    // settles) WITHOUT settling — it never completed, so it does not count.
    await session.run(() => kit.llmTurns[0].pushDelta('late'))
    await waitFor(() => kit.llmTurns[0].finallyRan(), 'barged-in reply unwound')
    expect(kit.llmTurns[0].finallyRan()).toBe(true)
    expect(kit.llmTurns[0].settled()).toBe(false)

    // The new utterance finalizes into a fresh reply that runs to completion — the
    // guard was freed by the barge-in, so this `turn` is accepted (not rejected).
    socket.send(TURN)
    await waitFor(() => kit.llmTurns.length === 2, 'fresh reply reached the LLM')
    expect(messagesOfType(socket, 'error')).toEqual([])
    await session.run(() => kit.llmTurns[1].finishStream())
    await waitFor(() => kit.llmTurns[1].settled(), 'fresh reply settled')
    expect(kit.llmTurns[1].settled()).toBe(true)
    await waitFor(() => sawDoneChunk(socket), 'fresh reply done chunk')

    socket.send(END)
    await waitForMessage(socket, 'summary')
    // Only the completed second reply counts; the barged-in first never settled.
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })

  it('a turn with no prior speech-start is a benign no-op (no reply, no error, session stays usable)', async () => {
    const kit = makeLiveStreamingAsrProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // A `turn` with no open utterance: nothing to finalize — benign no-op.
    socket.send(TURN)
    await settle()
    expect(kit.sttCalls()).toBe(0)
    expect(messagesOfType(socket, 'transcript')).toEqual([])
    expect(messagesOfType(socket, 'chunk')).toEqual([])
    expect(messagesOfType(socket, 'error')).toEqual([])
    expect(socket.closeEvents).toEqual([])

    // The session stays usable: a real utterance afterwards runs normally.
    socket.send(SPEECH_START)
    socket.send(new Uint8Array([7, 8]).buffer)
    socket.send(TURN)
    await waitFor(() => sawDoneChunk(socket), 'a real utterance still runs after the benign turn')
    expect(kit.sttCalls()).toBe(1)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })

  it('pre-roll frames pushed before speech-start are prepended to the bridge in arrival order before live frames', async () => {
    const kit = makeInspectingProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // Three frames pushed BEFORE speech-start: the pre-roll ring buffer captures them.
    // The DO is continuously streaming audio from the client mic; these represent
    // the onset bytes that arrive before the client VAD qualifies speech.
    const preRoll1 = new Uint8Array([10, 20, 30])
    const preRoll2 = new Uint8Array([40, 50])
    const preRoll3 = new Uint8Array([60])
    socket.send(preRoll1.buffer)
    socket.send(preRoll2.buffer)
    socket.send(preRoll3.buffer)
    // Settle so the DO processes all three binary frames before speech-start
    // arrives (WS frames are ordered, but async DO processing needs draining).
    await settle()

    // speech-start flushes the pre-roll buffer into the new AudioBridge, then
    // live frames flow directly into it.
    socket.send(SPEECH_START)
    await waitFor(() => kit.sttCalls() === 1, 'recognizer opened on speech-start')

    // Two live frames pushed AFTER speech-start go directly into the bridge.
    const live1 = new Uint8Array([70, 80, 90])
    const live2 = new Uint8Array([100])
    socket.send(live1.buffer)
    socket.send(live2.buffer)

    // turn closes the bridge: the inspecting STT drains all frames and finalizes.
    socket.send(TURN)
    await waitFor(() => sawDoneChunk(socket), 'reply completed after turn')

    // The STT captured exactly 5 frames in arrival order: 3 pre-roll then 2 live.
    expect(kit.frames()).toHaveLength(5)
    expect(kit.frames()[0]).toEqual(preRoll1)
    expect(kit.frames()[1]).toEqual(preRoll2)
    expect(kit.frames()[2]).toEqual(preRoll3)
    expect(kit.frames()[3]).toEqual(live1)
    expect(kit.frames()[4]).toEqual(live2)

    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(1)
  })

  it('pre-roll ring caps at PREROLL_MAX_BYTES by evicting oldest frames', async () => {
    const kit = makeInspectingProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // Push 50 frames of 1 000 bytes each = 50 000 bytes total, well over the
    // 22 400 byte cap. The ring must evict the oldest frames so only the newest
    // ~22 frames (the tail of the stream, closest to speech onset) are retained.
    const FRAME_BYTES = 1_000
    const FRAME_COUNT = 50
    for (let i = 0; i < FRAME_COUNT; i += 1) {
      // Fill each frame with a distinct byte value so we can identify which
      // frames the STT received (oldest vs newest).
      socket.send(new Uint8Array(FRAME_BYTES).fill(i).buffer)
    }
    await settle()

    socket.send(SPEECH_START)
    await waitFor(() => kit.sttCalls() === 1, 'recognizer opened after overflow pre-roll')

    // No live frames; turn closes the bridge immediately.
    socket.send(TURN)
    await waitFor(() => sawDoneChunk(socket), 'reply completed after capped pre-roll')

    // Total bytes received by STT must be within the cap (all bytes came from pre-roll).
    expect(kit.bytes().byteLength).toBeLessThanOrEqual(PREROLL_MAX_BYTES)
    // At least one frame must be retained.
    expect(kit.frames().length).toBeGreaterThan(0)
    // The retained frames are the NEWEST ones (oldest were evicted).
    // The last frame sent has fill value FRAME_COUNT - 1 = 49.
    expect(kit.frames().at(-1)![0]).toBe(FRAME_COUNT - 1)

    socket.send(END)
    await waitForMessage(socket, 'summary')
  })
})
