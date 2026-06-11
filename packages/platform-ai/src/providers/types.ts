/**
 * Three-layer provider semantic interfaces: STT / LLM / TTS.
 *
 * Each layer defines one streaming-shaped semantic interface; concrete vendor
 * adapters implement them in a later round (R2). The platform picks which
 * adapter each game/layer uses via `provider-config`.
 *
 * Design constraints from the L2 spec encoded here:
 *  - The LLM interface is shaped as "OpenAI-compatible chat completions,
 *    streaming". One adapter then covers every OpenAI-compatible vendor
 *    (DeepSeek v4 is the default), rather than one adapter per vendor.
 *  - The voice layer (STT + TTS) is a shared platform layer — a single
 *    Volcengine (火山) speech adapter backs both, not one per LLM provider.
 *  - These are streaming forms: STT and TTS consume/produce async chunk
 *    streams; the LLM yields incremental completion deltas.
 */

import type { AudioChunk } from '../contract'

// --- LLM layer (OpenAI-compatible chat completions, streaming) ---

/** OpenAI-compatible message role. */
export type ChatRole = 'system' | 'user' | 'assistant'

/**
 * One OpenAI-compatible chat message. This is the shape produced by the
 * deterministic manual-injection step (see `manual-injection.ts`) and consumed
 * by the LLM provider.
 */
export interface ChatMessage {
  role: ChatRole
  content: string
}

/**
 * Request to the LLM layer, mirroring an OpenAI-compatible chat completions
 * call with `stream: true`. `model` selects the concrete model behind the
 * adapter (e.g. 'deepseek-v4-flash'); `messages` is the fully-assembled context.
 */
export interface LlmCompletionRequest {
  model: string
  messages: ChatMessage[]
  /** Optional sampling temperature, passed through to the vendor as-is. */
  temperature?: number
}

/**
 * One streamed completion delta — the OpenAI-compatible `choices[].delta`
 * shape reduced to what the turn pipeline needs. `content` is the incremental
 * assistant text for this chunk; `done` marks the final delta of the stream
 * (the adapter maps the vendor's `data: [DONE]` sentinel onto it).
 */
export interface LlmCompletionChunk {
  content: string
  done: boolean
}

/**
 * Token usage for one completion. Populated by the adapter from the vendor's
 * usage report (or estimated) and forwarded to the session's metering mount.
 */
export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * LLM provider layer. One OpenAI-compatible streaming adapter implements this
 * for all OpenAI-compatible vendors.
 */
export interface LlmProvider {
  /**
   * Stream a chat completion. Yields incremental text deltas until a `done`
   * chunk. The final usage report is exposed via `lastUsage` after the stream
   * is fully consumed (kept off the chunk stream so the per-token hot path
   * stays text-only).
   */
  streamCompletion(request: LlmCompletionRequest): AsyncIterable<LlmCompletionChunk>
}

// --- STT layer (streaming speech-to-text) ---

/**
 * One streamed transcription result. `text` is the cumulative-or-incremental
 * transcript for this chunk (the adapter owns which); `isFinal` marks a
 * stabilized segment the turn pipeline may forward to the LLM.
 */
export interface SttTranscriptChunk {
  text: string
  isFinal: boolean
}

/**
 * STT provider layer. The first adapter is Volcengine (火山) modular ASR over
 * its self-owned WebSocket protocol; that adapter is shared with TTS as the
 * platform voice layer.
 */
export interface SttProvider {
  /**
   * Stream player audio frames in, yield transcription chunks out. The input
   * is an async stream of audio frames (the session WebSocket's inbound side);
   * the output is the transcript stream consumed by the LLM step.
   */
  transcribe(audio: AsyncIterable<AudioChunk>): AsyncIterable<SttTranscriptChunk>
}

// --- TTS layer (streaming text-to-speech) ---

/**
 * One synthesized audio frame produced by the TTS layer. `audio` is the frame
 * pushed back over the session WebSocket; `done` marks the final frame for the
 * synthesized utterance.
 */
export interface TtsAudioChunk {
  audio: Uint8Array
  done: boolean
}

/**
 * TTS provider layer. The first adapter shares the Volcengine (火山) speech
 * adapter with STT (Doubao TTS 2.0 streaming) — the voice layer is shared, not
 * duplicated per LLM provider.
 */
export interface TtsProvider {
  /**
   * Stream LLM text in, yield synthesized audio frames out. The input is the
   * sentence-segmented assistant text from the LLM step; the output is the
   * audio-frame stream pushed back to the player.
   */
  synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk>
}
