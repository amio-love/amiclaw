import { describe, expect, it } from 'vitest'
import { runTurn, splitSentences, type SessionState, type TurnProviders } from './turn-pipeline'
import type { AiResponseChunk, AudioChunk, ManualData } from './contract'
import type {
  LlmCompletionChunk,
  LlmCompletionRequest,
  LlmProvider,
  SttProvider,
  SttTranscriptChunk,
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

/** STT mock: ignores audio, replays a fixed transcript sequence. */
function mockStt(transcripts: SttTranscriptChunk[]): SttProvider {
  return {
    async *transcribe(audio: AsyncIterable<AudioChunk>): AsyncIterable<SttTranscriptChunk> {
      // Drain audio so the bridge closes cleanly, then emit transcripts.
      for await (const _ of audio) void _
      yield* fromArray(transcripts)
    },
  }
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
  llm: { provider: 'deepseek', model: 'deepseek-v4-flash', fallback: [] },
  stt: { provider: 'volcengine', model: 'bigmodel', fallback: [] },
  tts: { provider: 'volcengine', model: 'doubao', fallback: [] },
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

  it('estimates non-zero STT/TTS audio seconds from the bytes that flowed', async () => {
    // 32000 bytes = 1.0s under the PCM-16 mono 16kHz estimate. Feed exactly that
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
    // TTS produced at least one audio frame, so its seconds estimate is > 0.
    expect(state.usage.ttsOutputSeconds).toBeGreaterThan(0)
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
})
