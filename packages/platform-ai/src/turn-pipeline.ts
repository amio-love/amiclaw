/**
 * Turn-pipeline orchestration — the testable core of the voice session
 * (L2 §Mechanism Variant 1).
 *
 * One player turn is a pipeline: player audio -> STT transcript -> deterministic
 * manual injection + history -> LLM streaming text -> sentence segmentation ->
 * TTS audio -> interleaved `AiResponseChunk` stream back to the player.
 *
 * The Durable Object that owns the WebSocket is a thin shell over `runTurn`:
 * `runTurn` is a provider-injected async generator that takes the three
 * providers, the mutable session state, and the inbound audio stream, and yields
 * the ordered `AiResponseChunk` stream. It does no I/O of its own (only drives
 * the injected providers) but it *does* mutate `state` (history, turnCount,
 * usage) — it is I/O-free, not side-effect-free. Keeping the orchestration here
 * (no WS, no DO, no clock) makes it unit-testable with three mocked providers.
 *
 * Volcengine ASR note: the current Volcengine ASR adapter returns the
 * *cumulative* full transcript on each chunk (not an incremental delta). So the
 * player's utterance for the turn is the text of the LAST `isFinal` chunk — we
 * take the final cumulative text, not a concatenation of fragments.
 */

import type { CompanionContext } from '../../companion-memory/src/types'
import type { AiResponseChunk, AudioChunk } from './contract'
import type { ChatMessage, LlmProvider, SttProvider, TtsProvider } from './providers/types'
import { assembleLlmContext, type GameState } from './manual-injection'
import type { ResolvedConfig } from './provider-config'
import type { ManualData } from './contract'

/** Usage counters accumulated across a session (mirrors `SessionSummary.usage`). */
export interface UsageCounters {
  llmInputTokens: number
  llmOutputTokens: number
  sttInputSeconds: number
  ttsOutputSeconds: number
}

/**
 * Audio-duration estimation constant. Both the Volcengine ASR input and the
 * Doubao TTS output are PCM 16-bit mono at 16 kHz (the adapter's
 * `DEFAULT_SAMPLE_RATE`), i.e. 16000 samples/s * 2 bytes/sample = 32000 bytes/s.
 *
 * v1 estimate / metering mount point: the pipeline only sees opaque byte frames,
 * so it derives seconds from byte length under this fixed-format assumption.
 * Precise, per-provider sample-rate-aware accounting (and any non-PCM codec)
 * lives in the downstream `add-usage-metering` task; this fills the counters
 * with a real, non-zero estimate instead of silently reporting 0.
 */
const PCM16_MONO_16K_BYTES_PER_SECOND = 32000

/** Estimate audio seconds from a raw PCM-frame byte count (see constant above). */
function estimateAudioSeconds(byteLength: number): number {
  return byteLength / PCM16_MONO_16K_BYTES_PER_SECOND
}

/**
 * Mutable per-session state the pipeline reads and updates. Held by the DO;
 * passed by reference into `runTurn` so a completed turn's history + usage carry
 * into the next turn.
 */
export interface SessionState {
  /** Resolved provider/prompt config for this session's game. */
  config: ResolvedConfig
  /** This run's manual payload (deterministic injection source). */
  manualData: ManualData
  /** Current game state driving manual-subset selection. */
  gameState: GameState
  /** Rolling conversation history (user/assistant turns), excluding system. */
  history: ChatMessage[]
  /** Number of completed player->AI turns. */
  turnCount: number
  /** Accumulated usage counters. */
  usage: UsageCounters
  /**
   * Companion context resolved at session assembly (companion-memory).
   * Optional: absent = memory-less session, injection is a no-op.
   */
  companionContext?: CompanionContext
  /**
   * Join key correlating this session's summary with the run's settlement
   * event, supplied by the consumer at `create`. Optional (additive).
   */
  gameRunId?: string
}

/** The three wired providers a turn drives. */
export interface TurnProviders {
  stt: SttProvider
  llm: LlmProvider
  tts: TtsProvider
}

/**
 * LLM provider instances may expose a `lastUsage` after a stream is drained
 * (the DeepSeek adapter does). We read it structurally so the pipeline does not
 * depend on the concrete adapter type.
 */
interface MaybeUsageProvider {
  lastUsage?: { inputTokens: number; outputTokens: number }
}

/**
 * Split a growing assistant text buffer into complete sentences plus a
 * remainder. A sentence boundary is a CJK/ASCII terminal punctuation mark; the
 * trailing unterminated fragment stays in the remainder until more text (or the
 * stream end) completes it. Pure and total.
 */
export function splitSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  let start = 0
  for (let i = 0; i < buffer.length; i += 1) {
    const ch = buffer[i]
    if (ch === '.' || ch === '!' || ch === '?' || ch === '。' || ch === '！' || ch === '？') {
      const sentence = buffer.slice(start, i + 1).trim()
      if (sentence.length > 0) sentences.push(sentence)
      start = i + 1
    }
  }
  return { sentences, remainder: buffer.slice(start) }
}

/**
 * Drain an STT transcript stream and return the player's utterance for the
 * turn: the text of the last `isFinal` chunk (cumulative ASR semantics). If no
 * `isFinal` chunk arrives, fall back to the last chunk's text (best effort), or
 * empty string for an empty stream.
 *
 * Also reports `audioBytes`: the total byte length of the inbound audio frames
 * the STT provider actually pulled, tapped via a counting passthrough. The
 * caller turns this into the STT input-seconds usage estimate. The passthrough
 * forwards every frame unchanged, so STT behaviour is unaffected.
 */
async function collectFinalTranscript(
  stt: SttProvider,
  audio: AsyncIterable<AudioChunk>
): Promise<{ transcript: string; audioBytes: number }> {
  let audioBytes = 0
  const counted: AsyncIterable<AudioChunk> = {
    async *[Symbol.asyncIterator]() {
      for await (const frame of audio) {
        audioBytes += frame.byteLength
        yield frame
      }
    },
  }

  let lastFinal: string | undefined
  let lastAny = ''
  for await (const chunk of stt.transcribe(counted)) {
    lastAny = chunk.text
    if (chunk.isFinal) lastFinal = chunk.text
  }
  return { transcript: (lastFinal ?? lastAny).trim(), audioBytes }
}

/**
 * A tiny single-producer/single-consumer async string queue. The LLM loop
 * pushes complete sentences in; the TTS provider consumes them via `for await`.
 * Decoupling them lets text chunks surface to the player as the LLM streams,
 * while TTS synthesis runs concurrently.
 */
class SentenceQueue {
  private buffer: string[] = []
  private resolvers: Array<(r: IteratorResult<string>) => void> = []
  private closed = false

  push(sentence: string): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve({ value: sentence, done: false })
    } else {
      this.buffer.push(sentence)
    }
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      this.resolvers.shift()?.({ value: undefined, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for (;;) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as string
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<string>>((resolve) => {
        this.resolvers.push(resolve)
      })
      if (next.done) return
      yield next.value
    }
  }
}

/**
 * Run one player turn end to end.
 *
 * Yields the turn's `AiResponseChunk`s in order: incremental `text` chunks as
 * the LLM streams, `audio` chunks as TTS synthesizes the segmented sentences,
 * and exactly one terminal chunk with `done: true`. Mutates `state` (history,
 * turnCount, usage) as a side effect so the next turn sees this turn's context.
 *
 * I/O-free beyond driving the injected providers (it never touches the network,
 * a clock, or a socket directly) — fully unit-testable with mocked STT/LLM/TTS.
 */
export async function* runTurn(
  providers: TurnProviders,
  state: SessionState,
  audio: AsyncIterable<AudioChunk>
): AsyncIterable<AiResponseChunk> {
  // 1. STT: transcribe the player's audio; take the final cumulative transcript.
  //    `audioBytes` is the inbound-frame byte total, turned into the STT
  //    input-seconds usage estimate at turn settle.
  const { transcript: playerText, audioBytes: sttAudioBytes } = await collectFinalTranscript(
    providers.stt,
    audio
  )

  // 2. Inject: deterministic system message (role + rules + manual subset),
  //    then the rolling history, then this turn's player utterance.
  const systemMessages = assembleLlmContext({
    systemPromptConfig: state.config.systemPromptConfig,
    manualData: state.manualData,
    gameState: state.gameState,
    ...(state.companionContext !== undefined ? { companionContext: state.companionContext } : {}),
  })
  const userMessage: ChatMessage = { role: 'user', content: playerText }
  const messages: ChatMessage[] = [...systemMessages, ...state.history, userMessage]

  // 3. LLM + 4. TTS run concurrently: the LLM loop segments text into sentences
  //    and feeds a queue the TTS provider drains. We interleave text chunks
  //    (as the LLM streams) with audio chunks (as TTS produces them).
  const sentenceQueue = new SentenceQueue()
  const ttsIterator = providers.tts.synthesize(sentenceQueue)[Symbol.asyncIterator]()

  let assistantText = ''
  let pending = ''
  let ttsDone = false
  let nextTtsPromise: Promise<IteratorResult<{ audio: Uint8Array; done: boolean }>> | undefined =
    ttsIterator.next()

  const llmStream = providers.llm
    .streamCompletion({
      model: state.config.llm.model,
      messages,
    })
    [Symbol.asyncIterator]()

  let llmDone = false
  let nextLlmPromise: Promise<IteratorResult<{ content: string; done: boolean }>> | undefined =
    llmStream.next()

  // TTS output bytes tallied across the turn's synthesized frames, turned into
  // the TTS output-seconds usage estimate at turn settle.
  let ttsAudioBytes = 0

  // Drive both streams until both are exhausted. Whichever resolves first
  // produces the next chunk, so text and audio interleave in arrival order.
  // A provider error (either stream's `next()` rejects) propagates out of the
  // `Promise.race`; the `finally` below closes the sentence queue and returns
  // the live iterators so neither leaks nor hangs.
  try {
    while (!llmDone || !ttsDone) {
      const racers: Array<Promise<{ source: 'llm' | 'tts'; result: IteratorResult<unknown> }>> = []
      if (nextLlmPromise) {
        racers.push(nextLlmPromise.then((result) => ({ source: 'llm' as const, result })))
      }
      if (nextTtsPromise) {
        racers.push(nextTtsPromise.then((result) => ({ source: 'tts' as const, result })))
      }
      if (racers.length === 0) break

      const winner = await Promise.race(racers)

      if (winner.source === 'llm') {
        const result = winner.result as IteratorResult<{ content: string; done: boolean }>
        if (result.done || result.value.done) {
          // LLM stream finished. A finish chunk may still carry content (the
          // OpenAI-compatible stream can place the tail text on the chunk that
          // also sets `done: true`); append it BEFORE flushing + closing so the
          // tail reaches both the text stream and TTS, never dropped.
          llmDone = true
          nextLlmPromise = undefined
          if (!result.done && result.value.content.length > 0) {
            const delta = result.value.content
            assistantText += delta
            pending += delta
            yield { kind: 'text', text: delta, done: false }
          }
          const { sentences, remainder } = splitSentences(pending)
          for (const sentence of sentences) sentenceQueue.push(sentence)
          pending = remainder
          const tail = pending.trim()
          if (tail.length > 0) {
            sentenceQueue.push(tail)
            pending = ''
          }
          sentenceQueue.close()
        } else {
          const delta = result.value.content
          if (delta.length > 0) {
            assistantText += delta
            pending += delta
            yield { kind: 'text', text: delta, done: false }
            const { sentences, remainder } = splitSentences(pending)
            for (const sentence of sentences) sentenceQueue.push(sentence)
            pending = remainder
          }
          nextLlmPromise = llmStream.next()
        }
      } else {
        const result = winner.result as IteratorResult<{ audio: Uint8Array; done: boolean }>
        if (result.done) {
          ttsDone = true
          nextTtsPromise = undefined
        } else {
          if (result.value.audio.length > 0) {
            ttsAudioBytes += result.value.audio.byteLength
            yield { kind: 'audio', audio: result.value.audio, done: false }
          }
          if (result.value.done) {
            ttsDone = true
            nextTtsPromise = undefined
          } else {
            nextTtsPromise = ttsIterator.next()
          }
        }
      }
    }
  } finally {
    // Cleanup on any exit path — normal completion or a provider error. The
    // error path is "fail loud": the rejection from `Promise.race` propagates to
    // the caller (no error chunk is fabricated); here we only release resources
    // so a half-driven turn cannot leak the queue or a live iterator. `close()`
    // is idempotent; `return()` on an async iterator that has no `return` is a
    // no-op, so both are safe to call unconditionally.
    sentenceQueue.close()
    await ttsIterator.return?.(undefined)
    await llmStream.return?.(undefined)
  }

  // 5. Settle turn state: record history, count, and usage; emit the terminal
  //    chunk so the consumer can close out the turn.
  state.history.push(userMessage)
  state.history.push({ role: 'assistant', content: assistantText })
  state.turnCount += 1

  const usage = (providers.llm as MaybeUsageProvider).lastUsage
  if (usage) {
    state.usage.llmInputTokens += usage.inputTokens
    state.usage.llmOutputTokens += usage.outputTokens
  }
  // Best-effort audio-duration metering (v1 estimate; see
  // `estimateAudioSeconds`). Filled from the bytes that actually flowed this
  // turn so `endSession` reports a real estimate, not a silent 0.
  state.usage.sttInputSeconds += estimateAudioSeconds(sttAudioBytes)
  state.usage.ttsOutputSeconds += estimateAudioSeconds(ttsAudioBytes)

  yield { kind: 'text', text: '', done: true }
}
