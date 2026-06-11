/**
 * Deterministic mock provider layer — first-party demo / e2e harness backend.
 *
 * These mocks implement the same three semantic interfaces as the real R2
 * adapters (`SttProvider` / `LlmProvider` / `TtsProvider`) but with NO network,
 * NO credentials, and fully deterministic output. They let the demo harness and
 * e2e scenarios drive the whole STT -> LLM -> TTS pipeline ("speak -> see/hear an
 * AI reply grounded in the injected manual") without provisioning real DeepSeek
 * or Volcengine (火山) keys.
 *
 * Determinism is the contract:
 *   - STT maps any non-empty inbound audio stream to one fixed example
 *     transcript, so a turn always has a stable player utterance.
 *   - LLM reads the injected manual subset out of its `system` message and
 *     replies with a deterministic, manual-grounded sentence (no randomness, no
 *     clock). Given the same messages it yields byte-identical deltas.
 *   - TTS maps each input sentence to a fake audio frame whose bytes are the
 *     UTF-8 encoding of the sentence, so "audio was produced for this text" is
 *     observable in tests without a codec.
 *
 * The mocks hold no secrets and no system prompt of their own: the LLM mock
 * only echoes back the manual material the platform already injected server-side
 * (the same injection path the real adapter sees), so the "prompt is
 * server-side only" invariant is unaffected.
 */

import type {
  ChatMessage,
  LlmCompletionChunk,
  LlmCompletionRequest,
  LlmProvider,
  LlmUsage,
  SttProvider,
  SttTranscriptChunk,
  SttUsage,
  TtsAudioChunk,
  TtsProvider,
} from './types'
import type { AudioChunk } from '../contract'

/** The fixed transcript the mock STT resolves every spoken turn to. */
export const MOCK_TRANSCRIPT = '我看到面板上有一个红色的按钮，旁边写着 ABORT。'

const textEncoder = new TextEncoder()

/** Options for the mock LLM provider. */
export interface MockLlmProviderOptions {
  /**
   * Fixed token usage reported after each completion, so the pipeline's usage
   * accounting path is exercised deterministically. Defaults to a small
   * non-zero pair.
   */
  usage?: LlmUsage
}

/**
 * A mock LLM provider. Mirrors the `DeepSeekLlmProvider` shape (exposes an
 * optional `lastUsage` the turn pipeline reads structurally) so it is a
 * drop-in substitute on the LLM slot.
 */
export interface MockLlmProvider extends LlmProvider {
  /** Token usage from the most recently consumed completion. */
  lastUsage?: LlmUsage
}

/**
 * Extract the first injected manual line from the assembled system message.
 *
 * The platform injects the manual subset into the `system` message (see
 * `manual-injection.ts`) under a `### <sectionId>` block. We surface the first
 * such block's first content line so the deterministic reply visibly depends on
 * the injected manual — demonstrating "the AI answers from the injected manual"
 * end to end. Falls back to a fixed phrase when no manual block is present.
 */
function firstInjectedManualLine(messages: ChatMessage[]): string {
  const system = messages.find((m) => m.role === 'system')
  if (!system) return '（无注入手册）'
  const lines = system.content.split('\n')
  const headerIdx = lines.findIndex((line) => line.startsWith('### '))
  if (headerIdx === -1) return '（无注入手册）'
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line.length > 0) return line
  }
  return '（无注入手册）'
}

/**
 * Create a deterministic mock LLM provider. It reads the manual subset the
 * platform injected into the system message and streams a fixed, manual-grounded
 * reply as a few content deltas (so the streaming + sentence-segmentation path
 * is exercised), followed by the terminal `done` chunk. No network, no key.
 */
export function createMockLlmProvider(options: MockLlmProviderOptions = {}): MockLlmProvider {
  const usage: LlmUsage = options.usage ?? { inputTokens: 12, outputTokens: 24 }

  const provider: MockLlmProvider = {
    async *streamCompletion(request: LlmCompletionRequest): AsyncIterable<LlmCompletionChunk> {
      provider.lastUsage = undefined
      const manualLine = firstInjectedManualLine(request.messages)
      // Deterministic, manual-grounded reply. Split into sentences so the
      // pipeline's sentence segmentation + TTS hand-off is exercised.
      const reply = [
        `好的，根据手册我看到这一条：${manualLine}`,
        '请先确认你看到的按钮颜色，再告诉我。',
      ]
      for (const sentence of reply) {
        yield { content: sentence, done: false }
      }
      provider.lastUsage = usage
      yield { content: '', done: true }
    },
  }

  return provider
}

/** Options for the mock STT provider. */
export interface MockSttProviderOptions {
  /**
   * Fixed STT usage reported after each transcribe stream, so tests can drive
   * the pipeline's structured STT metering path deterministically. When
   * omitted, the mock exposes NO usage — the pipeline then exercises its
   * byte-derived fallback path, matching the pre-metering behavior.
   */
  usage?: SttUsage
}

/**
 * A mock STT provider. Mirrors the Volcengine adapter's shape (exposes an
 * optional `lastUsage` the turn pipeline reads structurally) so it is a
 * drop-in substitute on the STT slot.
 */
export interface MockSttProvider extends SttProvider {
  /** STT usage from the most recently consumed transcribe stream. */
  lastUsage?: SttUsage
}

/**
 * Create a deterministic mock STT provider. Drains the inbound audio stream
 * (so the audio bridge is consumed exactly like the real adapter) and yields a
 * single final transcript chunk carrying the fixed example utterance. An empty
 * audio stream still yields the fixed transcript so a turn always has text.
 */
export function createMockSttProvider(options: MockSttProviderOptions = {}): MockSttProvider {
  const provider: MockSttProvider = {
    async *transcribe(audio: AsyncIterable<AudioChunk>): AsyncIterable<SttTranscriptChunk> {
      provider.lastUsage = undefined
      // Consume the inbound frames so the bridge drains; the content is ignored
      // (deterministic transcript), but draining matches real-adapter behavior.
      for await (const _frame of audio) {
        // intentionally empty — frames are consumed, not inspected
      }
      provider.lastUsage = options.usage
      yield { text: MOCK_TRANSCRIPT, isFinal: true }
    },
  }
  return provider
}

/**
 * Create a deterministic mock TTS provider. Maps each input sentence to one
 * fake audio frame whose bytes are the UTF-8 encoding of the sentence, then a
 * terminal `done` frame. This makes "audio was synthesized for this text"
 * observable in tests without a real codec.
 */
export function createMockTtsProvider(): TtsProvider {
  return {
    async *synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk> {
      for await (const sentence of text) {
        yield { audio: textEncoder.encode(sentence), done: false }
      }
      yield { audio: new Uint8Array(0), done: true }
    },
  }
}

/**
 * Build the shared mock speech pair (STT + TTS). Mirrors
 * `createVolcengineSpeechProvider`'s return shape so the factory wires the mock
 * voice layer through the same code path as the real shared speech adapter.
 */
export function createMockSpeechProvider(): { stt: SttProvider; tts: TtsProvider } {
  return { stt: createMockSttProvider(), tts: createMockTtsProvider() }
}
