import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENING_DIRECTIVE,
  runOpeningTurn,
  runTurn,
  splitSentences,
  type SessionState,
  type TurnProviders,
} from './turn-pipeline'
import { createDeepSeekLlmProvider } from './providers/deepseek'
import type { AiResponseChunk, AudioChunk, ManualData } from './contract'
import type {
  LlmCompletionChunk,
  LlmCompletionRequest,
  LlmProvider,
  SttProvider,
  SttTranscriptChunk,
  SttUsage,
  TtsAudioChunk,
  TtsProvider,
} from './providers/types'
import type { ResolvedConfig } from './provider-config'

// --- helpers -------------------------------------------------------------

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item
}

async function collect(stream: AsyncIterable<AiResponseChunk>): Promise<AiResponseChunk[]> {
  const out: AiResponseChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

/**
 * STT mock: ignores audio, replays a fixed transcript sequence. When `usage`
 * is given, exposes it as `lastUsage` after the stream drains (the structured
 * STT metering channel); without it, the pipeline's byte-tap fallback applies.
 */
function mockStt(
  transcripts: SttTranscriptChunk[],
  opts: { usage?: SttUsage } = {}
): SttProvider & { lastUsage?: SttUsage } {
  const provider: SttProvider & { lastUsage?: SttUsage } = {
    async *transcribe(audio: AsyncIterable<AudioChunk>): AsyncIterable<SttTranscriptChunk> {
      provider.lastUsage = undefined
      // Drain audio so the bridge closes cleanly, then emit transcripts.
      for await (const _ of audio) void _
      provider.lastUsage = opts.usage
      yield* fromArray(transcripts)
    },
  }
  return provider
}

/** LLM mock: records the request, streams the given content deltas, then done. */
function mockLlm(
  deltas: string[],
  opts: {
    usage?: { inputTokens: number; outputTokens: number }
    capture?: (r: LlmCompletionRequest) => void
  } = {}
): LlmProvider & { lastUsage?: { inputTokens: number; outputTokens: number } } {
  const provider: LlmProvider & { lastUsage?: { inputTokens: number; outputTokens: number } } = {
    async *streamCompletion(request: LlmCompletionRequest): AsyncIterable<LlmCompletionChunk> {
      opts.capture?.(request)
      for (const content of deltas) yield { content, done: false }
      provider.lastUsage = opts.usage
      yield { content: '', done: true }
    },
  }
  return provider
}

/** LLM mock: streams the exact chunks given (incl. a content-bearing done chunk). */
function rawLlm(chunks: LlmCompletionChunk[]): LlmProvider {
  return {
    async *streamCompletion(): AsyncIterable<LlmCompletionChunk> {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** LLM mock: yields one delta, then rejects — exercises the error cleanup path. */
function rejectingLlm(message: string): LlmProvider {
  return {
    async *streamCompletion(): AsyncIterable<LlmCompletionChunk> {
      yield { content: 'partial ', done: false }
      throw new Error(message)
    },
  }
}

/** TTS mock: records the sentences it received, emits one audio frame each. */
function mockTts(received: string[]): TtsProvider {
  return {
    async *synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk> {
      for await (const sentence of text) {
        received.push(sentence)
        yield { audio: new Uint8Array([sentence.length]), done: false }
      }
      yield { audio: new Uint8Array(0), done: true }
    },
  }
}

const resolvedConfig: ResolvedConfig = {
  gameId: 'demo',
  systemPromptConfig: { role: 'guide', ruleTemplate: ['rule one'] },
  llm: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  stt: { provider: 'volcengine', model: 'bigmodel' },
  tts: { provider: 'volcengine', model: 'doubao' },
}

const manualData: ManualData = { version: 'v1', sections: { intro: { text: 'hi' } } }

function freshState(): SessionState {
  return {
    config: resolvedConfig,
    manualData,
    gameState: { relevantSections: ['intro'] },
    history: [],
    turnCount: 0,
    usage: { llmInputTokens: 0, llmOutputTokens: 0, sttInputSeconds: 0, ttsOutputSeconds: 0 },
    sttSource: 'provider-reported',
  }
}

function providers(stt: SttProvider, llm: LlmProvider, tts: TtsProvider): TurnProviders {
  return { stt, llm, tts }
}

// --- splitSentences (pure) ----------------------------------------------

describe('splitSentences', () => {
  it('splits on ASCII and CJK terminal punctuation', () => {
    const { sentences, remainder } = splitSentences('Hello. World! 你好。tail')
    expect(sentences).toEqual(['Hello.', 'World!', '你好。'])
    expect(remainder).toBe('tail')
  })

  it('keeps an unterminated fragment in the remainder', () => {
    const { sentences, remainder } = splitSentences('no terminator yet')
    expect(sentences).toEqual([])
    expect(remainder).toBe('no terminator yet')
  })
})

// --- runTurn orchestration ----------------------------------------------

describe('runTurn', () => {
  it('chains STT -> manual injection -> LLM -> TTS and emits ordered chunks', async () => {
    const ttsReceived: string[] = []
    let capturedRequest: LlmCompletionRequest | undefined
    const turn = runTurn(
      providers(
        mockStt([{ text: 'I see a red wire.', isFinal: true }]),
        mockLlm(['Cut the ', 'blue wire.'], { capture: (r) => (capturedRequest = r) }),
        mockTts(ttsReceived)
      ),
      freshState(),
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    const chunks = await collect(turn)

    // The LLM saw: system message (role+rules+manual) + the player utterance.
    expect(capturedRequest?.messages[0].role).toBe('system')
    expect(capturedRequest?.messages[0].content).toContain('rule one')
    expect(capturedRequest?.messages[0].content).toContain('intro')
    const lastMessage = capturedRequest?.messages.at(-1)
    expect(lastMessage).toEqual({ role: 'user', content: 'I see a red wire.' })

    // TTS received the segmented sentence assembled from the LLM deltas.
    expect(ttsReceived).toEqual(['Cut the blue wire.'])

    // Text chunks arrive, audio chunks arrive, exactly one terminal done chunk.
    const textChunks = chunks.filter((c) => c.kind === 'text' && !c.done)
    const audioChunks = chunks.filter((c) => c.kind === 'audio')
    expect(textChunks.map((c) => c.text)).toEqual(['Cut the ', 'blue wire.'])
    expect(audioChunks.length).toBeGreaterThan(0)

    const doneChunks = chunks.filter((c) => c.done)
    expect(doneChunks).toHaveLength(1)
    expect(doneChunks[0].done).toBe(true)
    expect(chunks.at(-1)?.done).toBe(true)
  })

  it('attaches the session id to production turn-trace lines', async () => {
    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      if (typeof message === 'string') logs.push(message)
    })
    try {
      const state = freshState()
      state.traceSessionId = 'session-trace-1'
      const turn = runTurn(
        providers(
          mockStt([{ text: 'I see a red wire.', isFinal: true }]),
          mockLlm(['Cut the blue wire.']),
          mockTts([])
        ),
        state,
        fromArray<AudioChunk>([new Uint8Array([1])])
      )
      await collect(turn)

      const traces = logs
        .map(
          (line) =>
            JSON.parse(line) as { t?: string; hop?: string; stage?: string; sessionId?: string }
        )
        .filter((entry) => entry.t === 'turn-trace')

      expect(traces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            hop: 'turn',
            stage: 'pipeline-start',
            sessionId: 'session-trace-1',
          }),
          expect.objectContaining({
            hop: 'asr',
            stage: 'final-transcript',
            sessionId: 'session-trace-1',
          }),
          expect.objectContaining({
            hop: 'llm',
            stage: 'first-delta',
            sessionId: 'session-trace-1',
          }),
          expect.objectContaining({
            hop: 'tts',
            stage: 'first-frame',
            sessionId: 'session-trace-1',
          }),
          expect.objectContaining({
            hop: 'turn',
            stage: 'settle',
            sessionId: 'session-trace-1',
          }),
        ])
      )
      expect(traces.every((entry) => entry.sessionId === 'session-trace-1')).toBe(true)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('emits the player transcript as a leading chunk, before the AI reply chunks', async () => {
    const turn = runTurn(
      providers(
        // A single terminal (isFinal) STT chunk: no interim updates, just the
        // complete utterance — emitted once as the terminal `final: true` frame.
        mockStt([{ text: 'I see a red wire.', isFinal: true }]),
        mockLlm(['Cut the ', 'blue wire.']),
        mockTts([])
      ),
      freshState(),
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    const chunks = await collect(turn)

    // Exactly one transcript chunk — the terminal complete utterance (final:true)
    // carrying the PLAYER's recognized utterance (not AI text), not the turn's
    // terminal `done`.
    const transcriptChunks = chunks.filter((c) => c.kind === 'transcript')
    expect(transcriptChunks).toEqual([
      { kind: 'transcript', text: 'I see a red wire.', final: true, done: false },
    ])

    // It precedes every AI text/audio chunk: the first emitted chunk IS the
    // transcript, and no AI chunk appears before it.
    expect(chunks[0]).toEqual({
      kind: 'transcript',
      text: 'I see a red wire.',
      final: true,
      done: false,
    })
    const firstAiIndex = chunks.findIndex((c) => c.kind === 'text' || c.kind === 'audio')
    expect(chunks.findIndex((c) => c.kind === 'transcript')).toBeLessThan(firstAiIndex)

    // The AI reply chunks are unchanged: same text deltas, audio present, one
    // terminal done — the transcript chunk (kind 'transcript', done false) is not
    // counted among them.
    const textChunks = chunks.filter((c) => c.kind === 'text' && !c.done)
    expect(textChunks.map((c) => c.text)).toEqual(['Cut the ', 'blue wire.'])
    expect(chunks.filter((c) => c.kind === 'audio').length).toBeGreaterThan(0)
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
    expect(chunks.at(-1)?.done).toBe(true)
  })

  it('streams interim transcript frames (final:false) then one terminal final:true', async () => {
    // The live-subtitle contract: as the cumulative ASR result grows, each interim
    // result streams as a `transcript` chunk with `final: false` (the running
    // cumulative text, not a delta); the terminal (isFinal) result is emitted ONCE
    // as `final: true` carrying the complete utterance — never as a duplicate
    // interim. This is the full-transcript fix's client-facing half.
    const turn = runTurn(
      providers(
        mockStt([
          { text: 'I', isFinal: false },
          { text: 'I see', isFinal: false },
          { text: 'I see a red wire', isFinal: true },
        ]),
        mockLlm(['ok.']),
        mockTts([])
      ),
      freshState(),
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    const chunks = await collect(turn)

    const transcriptChunks = chunks.filter((c) => c.kind === 'transcript')
    expect(transcriptChunks).toEqual([
      { kind: 'transcript', text: 'I', final: false, done: false },
      { kind: 'transcript', text: 'I see', final: false, done: false },
      { kind: 'transcript', text: 'I see a red wire', final: true, done: false },
    ])
    // Exactly one terminal (final:true) transcript frame, carrying the complete
    // utterance; it is the last transcript frame and precedes all AI chunks.
    const finals = transcriptChunks.filter((c) => c.final === true)
    expect(finals).toHaveLength(1)
    expect(transcriptChunks.at(-1)?.final).toBe(true)
    const firstAiIndex = chunks.findIndex((c) => c.kind === 'text' || c.kind === 'audio')
    const lastTranscriptIndex =
      chunks.length - 1 - [...chunks].reverse().findIndex((c) => c.kind === 'transcript')
    expect(lastTranscriptIndex).toBeLessThan(firstAiIndex)
  })

  it('emits NO transcript chunk on a skipped no-speech turn', async () => {
    const chunks = await collect(
      runTurn(
        providers(mockStt([]), mockLlm(['ignored.']), mockTts([])),
        freshState(),
        fromArray<AudioChunk>([new Uint8Array([1])])
      )
    )
    // The benign no-speech skip returns before yielding anything — no transcript
    // chunk, no AI chunks at all.
    expect(chunks.filter((c) => c.kind === 'transcript')).toEqual([])
    expect(chunks).toEqual([])
  })

  it('takes the last isFinal transcript (cumulative ASR semantics)', async () => {
    let capturedRequest: LlmCompletionRequest | undefined
    const turn = runTurn(
      providers(
        // Cumulative full-text chunks: only the last isFinal is the utterance.
        mockStt([
          { text: 'I', isFinal: false },
          { text: 'I see', isFinal: false },
          { text: 'I see a red wire', isFinal: true },
        ]),
        mockLlm(['ok.'], { capture: (r) => (capturedRequest = r) }),
        mockTts([])
      ),
      freshState(),
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    await collect(turn)
    expect(capturedRequest?.messages.at(-1)).toEqual({ role: 'user', content: 'I see a red wire' })
  })

  // --- benign no-speech turn (hands-free false-positive VAD) -------------
  // A `turn` whose STT closes with no final transcript (no speech, no error) is
  // skipped: no AI response, no state change, no throw — the session stays alive.

  it('skips a no-speech turn: zero chunks, never drives LLM/TTS, no state mutation, no throw', async () => {
    const state = freshState()
    let llmCalled = false
    const ttsReceived: string[] = []
    const llm: LlmProvider = {
      async *streamCompletion(): AsyncIterable<LlmCompletionChunk> {
        llmCalled = true
        yield { content: '', done: true }
      },
    }

    // Empty STT stream — the adapter's benign no-final close surfaces here as an
    // empty transcript (see collectFinalTranscript / the volcengine close path).
    const chunks = await collect(
      runTurn(
        providers(mockStt([]), llm, mockTts(ttsReceived)),
        state,
        fromArray<AudioChunk>([new Uint8Array([1])])
      )
    )

    // No AI response chunks at all (not even a terminal done) and no downstream work.
    expect(chunks).toEqual([])
    expect(llmCalled).toBe(false)
    expect(ttsReceived).toEqual([])
    // State is byte-for-byte untouched: no history, no turn count, no usage.
    expect(state.turnCount).toBe(0)
    expect(state.history).toEqual([])
    expect(state.usage).toEqual({
      llmInputTokens: 0,
      llmOutputTokens: 0,
      sttInputSeconds: 0,
      ttsOutputSeconds: 0,
    })
    expect(state.sttSource).toBe('provider-reported')
  })

  it('treats a whitespace-only final transcript as no-speech and skips it', async () => {
    const state = freshState()
    let llmCalled = false
    const llm: LlmProvider = {
      async *streamCompletion(): AsyncIterable<LlmCompletionChunk> {
        llmCalled = true
        yield { content: '', done: true }
      },
    }
    const chunks = await collect(
      runTurn(
        providers(mockStt([{ text: '   ', isFinal: true }]), llm, mockTts([])),
        state,
        fromArray<AudioChunk>([new Uint8Array([1])])
      )
    )
    expect(chunks).toEqual([])
    expect(llmCalled).toBe(false)
    expect(state.turnCount).toBe(0)
  })

  it('leaves the session usable: a normal turn runs right after a skipped no-speech turn', async () => {
    const state = freshState()
    await collect(
      runTurn(
        providers(mockStt([]), mockLlm(['ignored.']), mockTts([])),
        state,
        fromArray<AudioChunk>([new Uint8Array([1])])
      )
    )
    // The skip left no residue.
    expect(state.turnCount).toBe(0)
    expect(state.history).toEqual([])

    const ttsReceived: string[] = []
    const chunks = await collect(
      runTurn(
        providers(
          mockStt([{ text: 'I see a red wire.', isFinal: true }]),
          mockLlm(['Cut it.']),
          mockTts(ttsReceived)
        ),
        state,
        fromArray<AudioChunk>([new Uint8Array([1])])
      )
    )
    // The next real turn runs normally end to end.
    expect(state.turnCount).toBe(1)
    expect(state.history).toEqual([
      { role: 'user', content: 'I see a red wire.' },
      { role: 'assistant', content: 'Cut it.' },
    ])
    expect(ttsReceived).toEqual(['Cut it.'])
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
  })

  it('still fails loud when STT throws a real ASR error (NOT a benign no-speech close)', async () => {
    // A genuine ASR error frame surfaces as a throw out of transcribe. That is a
    // real fault, not a benign no-speech close: the turn must propagate it (the
    // DO turns it into a 1008), never silently skip.
    const state = freshState()
    const throwingStt: SttProvider = {
      async *transcribe(audio: AsyncIterable<AudioChunk>): AsyncIterable<SttTranscriptChunk> {
        for await (const _ of audio) void _
        yield { text: '部分', isFinal: false }
        throw new Error('Volcengine ASR error: auth failed')
      },
    }
    await expect(
      collect(
        runTurn(
          providers(throwingStt, mockLlm(['nope.']), mockTts([])),
          state,
          fromArray<AudioChunk>([new Uint8Array([1])])
        )
      )
    ).rejects.toThrow(/Volcengine ASR error/)
    // A failed turn never settles, so it never mutates session state.
    expect(state.turnCount).toBe(0)
    expect(state.history).toEqual([])
  })

  it('accumulates usage and history across a turn', async () => {
    const state = freshState()
    const turn = runTurn(
      providers(
        mockStt([{ text: 'hello.', isFinal: true }]),
        mockLlm(['Hi there.'], { usage: { inputTokens: 42, outputTokens: 7 } }),
        mockTts([])
      ),
      state,
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    await collect(turn)

    expect(state.turnCount).toBe(1)
    expect(state.usage.llmInputTokens).toBe(42)
    expect(state.usage.llmOutputTokens).toBe(7)
    expect(state.history).toEqual([
      { role: 'user', content: 'hello.' },
      { role: 'assistant', content: 'Hi there.' },
    ])
  })

  it('derives non-zero STT/TTS audio seconds from the bytes that flowed (no adapter usage)', async () => {
    // 32000 bytes = 1.0s at the PCM-16 mono 16kHz byte rate. Feed exactly that
    // many inbound audio bytes; the mock TTS emits a frame per sentence whose
    // byte length is the sentence length (see mockTts), so TTS seconds are
    // small-but-non-zero. The point of the assertion: neither stays 0 (the bug
    // was a silent 0 even though audio flowed both ways).
    const state = freshState()
    const turn = runTurn(
      providers(
        mockStt([{ text: 'hi.', isFinal: true }]),
        mockLlm(['One sentence here.']),
        mockTts([])
      ),
      state,
      fromArray<AudioChunk>([new Uint8Array(16000), new Uint8Array(16000)])
    )
    await collect(turn)

    // 32000 inbound bytes -> exactly 1.0 STT second.
    expect(state.usage.sttInputSeconds).toBeCloseTo(1.0, 5)
    // TTS produced at least one audio frame, so its seconds figure is > 0.
    expect(state.usage.ttsOutputSeconds).toBeGreaterThan(0)
    // No structured STT usage was exposed -> the byte fallback ran and the
    // session's STT metering annotation latched to byte-derived.
    expect(state.sttSource).toBe('derived-from-bytes')
  })

  it('prefers the STT adapter usage report over the byte tap (provider-reported)', async () => {
    // The adapter reports 2500ms via the structured channel; the pipeline's own
    // byte tap saw 32000 bytes (= 1.0s). The provider value must win, and the
    // session annotation must STAY provider-reported.
    const state = freshState()
    const turn = runTurn(
      providers(
        mockStt([{ text: 'hi.', isFinal: true }], {
          usage: { durationMs: 2500, source: 'provider-reported' },
        }),
        mockLlm(['Ok.']),
        mockTts([])
      ),
      state,
      fromArray<AudioChunk>([new Uint8Array(32000)])
    )
    await collect(turn)

    expect(state.usage.sttInputSeconds).toBeCloseTo(2.5, 9)
    expect(state.sttSource).toBe('provider-reported')
  })

  it('an adapter-reported byte-derived usage still counts but downgrades the annotation', async () => {
    // The adapter itself fell back to its byte-rate conversion (no
    // audio_info.duration in any server response) and says so via the source
    // tag. The duration is taken as-is; the session annotation downgrades.
    const state = freshState()
    const turn = runTurn(
      providers(
        mockStt([{ text: 'hi.', isFinal: true }], {
          usage: { durationMs: 1500, source: 'derived-from-bytes' },
        }),
        mockLlm(['Ok.']),
        mockTts([])
      ),
      state,
      fromArray<AudioChunk>([new Uint8Array(1)])
    )
    await collect(turn)

    expect(state.usage.sttInputSeconds).toBeCloseTo(1.5, 9)
    expect(state.sttSource).toBe('derived-from-bytes')
  })

  it('one byte-derived turn latches the session annotation even after provider-reported turns', async () => {
    // Turn 1 is provider-reported; turn 2 has no structured usage (byte
    // fallback). The aggregate seconds add up and the annotation describes the
    // precision FLOOR: once any turn is byte-derived, the session is.
    const state = freshState()
    await collect(
      runTurn(
        providers(
          mockStt([{ text: 'one.', isFinal: true }], {
            usage: { durationMs: 1000, source: 'provider-reported' },
          }),
          mockLlm(['First.']),
          mockTts([])
        ),
        state,
        fromArray<AudioChunk>([new Uint8Array(1)])
      )
    )
    expect(state.sttSource).toBe('provider-reported')

    await collect(
      runTurn(
        providers(mockStt([{ text: 'two.', isFinal: true }]), mockLlm(['Second.']), mockTts([])),
        state,
        fromArray<AudioChunk>([new Uint8Array(32000)])
      )
    )

    expect(state.usage.sttInputSeconds).toBeCloseTo(2.0, 5)
    expect(state.sttSource).toBe('derived-from-bytes')
  })

  it('converts TTS seconds exactly from the synthesized bytes', async () => {
    // The TTS mock emits exactly the frames given: 48000 + 16000 bytes =
    // 64000 bytes = exactly 2.0s at the PCM-16 mono 16kHz byte rate. This is
    // the actual-product conversion, not an estimate: the tally is over the
    // frames the turn really yielded.
    const tts: TtsProvider = {
      async *synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk> {
        for await (const _ of text) void _
        yield { audio: new Uint8Array(48000), done: false }
        yield { audio: new Uint8Array(16000), done: false }
        yield { audio: new Uint8Array(0), done: true }
      },
    }
    const state = freshState()
    await collect(
      runTurn(
        providers(mockStt([{ text: 'hi.', isFinal: true }]), mockLlm(['Reply here.']), tts),
        state,
        fromArray<AudioChunk>([new Uint8Array(1)])
      )
    )

    expect(state.usage.ttsOutputSeconds).toBeCloseTo(2.0, 9)
  })

  // Intent: single-session ROLLING-HISTORY context, not cross-session
  // determinism. The pipeline mutates one `state`'s history, so within a session
  // the prior turns precede the new utterance. (Byte-identical-context
  // determinism is a separate property, covered for the pure injection step in
  // manual-injection.test.ts; it does NOT hold across turns of one session,
  // because each turn appends to history by design.)
  it('threads prior rolling history into the next turn context (single session)', async () => {
    const state = freshState()
    state.history = [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]
    let capturedRequest: LlmCompletionRequest | undefined
    const turn = runTurn(
      providers(
        mockStt([{ text: 'next.', isFinal: true }]),
        mockLlm(['reply.'], { capture: (r) => (capturedRequest = r) }),
        mockTts([])
      ),
      state,
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    await collect(turn)

    // The assembled context is exactly: system, prior user, prior assistant, new
    // user — the rolling history sits between the system message and this turn's
    // utterance, in order.
    expect(capturedRequest?.messages).toEqual([
      { role: 'system', content: capturedRequest?.messages[0].content },
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'next.' },
    ])
  })

  it('flushes an unterminated trailing sentence to TTS at stream end', async () => {
    const ttsReceived: string[] = []
    const turn = runTurn(
      providers(
        mockStt([{ text: 'q.', isFinal: true }]),
        // No terminal punctuation: the whole text is one trailing fragment.
        mockLlm(['just a fragment without punctuation']),
        mockTts(ttsReceived)
      ),
      freshState(),
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    await collect(turn)
    expect(ttsReceived).toEqual(['just a fragment without punctuation'])
  })

  it('does not drop content carried on a done chunk (OpenAI finish-chunk tail)', async () => {
    // OpenAI-compatible streams can place the tail text on the SAME chunk that
    // sets done:true. That tail must still reach the text stream AND TTS.
    const ttsReceived: string[] = []
    const turn = runTurn(
      providers(
        mockStt([{ text: 'q.', isFinal: true }]),
        rawLlm([
          { content: 'Cut the ', done: false },
          { content: 'tail.', done: true },
        ]),
        mockTts(ttsReceived)
      ),
      freshState(),
      fromArray<AudioChunk>([new Uint8Array([1])])
    )
    const chunks = await collect(turn)

    // The done-chunk tail is segmented into the final sentence and synthesized.
    expect(ttsReceived).toEqual(['Cut the tail.'])
    // It also surfaces as a text chunk (not the empty terminal one).
    const textChunks = chunks.filter((c) => c.kind === 'text' && !c.done)
    expect(textChunks.map((c) => c.text)).toEqual(['Cut the ', 'tail.'])
  })

  it('cleans up the TTS side when a provider rejects mid-turn', async () => {
    // The LLM stream rejects after one delta. The turn must surface the error,
    // and the cleanup path must close the sentence queue and return the active
    // TTS iterator so nothing leaks or hangs.
    let ttsClosed = false
    const tts: TtsProvider = {
      async *synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk> {
        try {
          for await (const sentence of text) {
            void sentence
            yield { audio: new Uint8Array(1), done: false }
          }
        } finally {
          // Runs on normal completion OR on an upstream `return()` — the latter
          // is what the pipeline's cleanup invokes on the error path.
          ttsClosed = true
        }
      },
    }
    const turn = runTurn(
      providers(mockStt([{ text: 'q.', isFinal: true }]), rejectingLlm('llm boom'), tts),
      freshState(),
      fromArray<AudioChunk>([new Uint8Array([1])])
    )

    await expect(collect(turn)).rejects.toThrow('llm boom')
    expect(ttsClosed).toBe(true)
  })

  // Regression (fix-llm-sse-stream-park): the LLM SSE stream returns its first
  // delta then goes permanently silent. End to end through the REAL DeepSeek
  // adapter, the turn must fail loud within a bounded time — never park forever —
  // and the TTS side must be cleaned up. This is the integration counterpart to
  // the adapter-level idle-timeout tests in deepseek.test.ts.
  describe('LLM SSE stream parks after its first delta', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('fails the turn loud (bounded) instead of parking, and cleans up TTS', async () => {
      const encoder = new TextEncoder()
      // DeepSeek-shaped body: one content delta, then never enqueue again and
      // never close — the observed park. The adapter's inter-chunk idle deadline
      // (injected small here) is the only thing that turns this into a bounded
      // failure rather than an infinite hang.
      const hangingBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: 'first ' } }] })}\n`
            )
          )
          // no further enqueue, no close — the park.
        },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, _init?: RequestInit) => new Response(hangingBody))
      )

      let ttsClosed = false
      const tts: TtsProvider = {
        async *synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk> {
          try {
            for await (const sentence of text) {
              void sentence
              yield { audio: new Uint8Array(1), done: false }
            }
          } finally {
            ttsClosed = true
          }
        },
      }
      const llm = createDeepSeekLlmProvider({ apiKey: 'sk-test', streamIdleMs: 40 })

      const start = performance.now()
      await expect(
        collect(
          runTurn(
            providers(mockStt([{ text: 'q.', isFinal: true }]), llm, tts),
            freshState(),
            fromArray<AudioChunk>([new Uint8Array([1])])
          )
        )
      ).rejects.toThrow(/deepseek: SSE stream idle for >40ms after first response/)
      // Bounded fail-loud, not a hang to the test timeout.
      expect(performance.now() - start).toBeLessThan(2000)
      // The turn's cleanup ran: the TTS iterator was returned, nothing leaked.
      expect(ttsClosed).toBe(true)
    })
  })
})

// --- runOpeningTurn: the AI-first greeting (LLM->TTS, no player audio) --------

describe('runOpeningTurn', () => {
  it('runs LLM+TTS with NO player audio, greeting from the server directive', async () => {
    const ttsReceived: string[] = []
    let captured: LlmCompletionRequest | undefined
    const state = freshState()
    const chunks = await collect(
      runOpeningTurn(
        {
          llm: mockLlm(['你好！', '请描述你看到的。'], { capture: (r) => (captured = r) }),
          tts: mockTts(ttsReceived),
        },
        state
      )
    )

    // No STT step: the synthetic, server-side opening directive stands in for the
    // (absent) player utterance — it is NEVER client-provided.
    expect(captured?.messages[0].role).toBe('system')
    expect(captured?.messages.at(-1)).toEqual({ role: 'user', content: OPENING_DIRECTIVE })

    // The greeting streams as text + audio chunks plus exactly one terminal done.
    const textChunks = chunks.filter((c) => c.kind === 'text' && !c.done)
    expect(textChunks.map((c) => c.text)).toEqual(['你好！', '请描述你看到的。'])
    expect(chunks.filter((c) => c.kind === 'audio').length).toBeGreaterThan(0)
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
    expect(ttsReceived).toEqual(['你好！', '请描述你看到的。'])

    // History remembers ONLY the greeting (never the synthetic directive), and the
    // opening turn does not count as a player turn.
    expect(state.history).toEqual([{ role: 'assistant', content: '你好！请描述你看到的。' }])
    expect(state.turnCount).toBe(0)
  })

  it('AI-speaks-first ordering: the greeting precedes the first player turn in context', async () => {
    const state = freshState()
    await collect(runOpeningTurn({ llm: mockLlm(['你好。']), tts: mockTts([]) }, state))

    let captured: LlmCompletionRequest | undefined
    await collect(
      runTurn(
        providers(
          mockStt([{ text: '红色按钮。', isFinal: true }]),
          mockLlm(['好的。'], { capture: (r) => (captured = r) }),
          mockTts([])
        ),
        state,
        fromArray<AudioChunk>([new Uint8Array([1])])
      )
    )

    // The first player turn sees the AI's own greeting as prior context, then the
    // player's transcribed utterance — exactly: system, assistant greeting, user.
    expect(captured?.messages).toEqual([
      { role: 'system', content: captured?.messages[0].content },
      { role: 'assistant', content: '你好。' },
      { role: 'user', content: '红色按钮。' },
    ])
    expect(state.turnCount).toBe(1)
  })

  it('does not meter STT for the opening turn (no audio consumed)', async () => {
    const state = freshState()
    await collect(runOpeningTurn({ llm: mockLlm(['hi.']), tts: mockTts([]) }, state))
    // The opening turn consumes no player audio, so STT seconds stay zero and the
    // session's STT annotation is untouched (still its initial provider-reported).
    expect(state.usage.sttInputSeconds).toBe(0)
    expect(state.sttSource).toBe('provider-reported')
  })
})
