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
 * Volcengine ASR note: the Volcengine ASR adapter returns the *cumulative* full
 * transcript on each chunk (not an incremental delta), and marks `isFinal` on the
 * TERMINAL (last-package) result — the whole utterance, not a mid-utterance
 * stabilized segment. So the player's complete utterance for the turn is the text
 * of the last `isFinal` chunk (or, absent a terminal, the last chunk seen before
 * a clean close). The pipeline streams every interim chunk to the client as a
 * live-subtitle `transcript` frame (`final: false`), then emits the complete
 * utterance once as the terminal `transcript` frame (`final: true`).
 */

import type { CompanionContext } from '../../companion-memory/src/types'
import type { AiResponseChunk, AudioChunk } from './contract'
import type {
  ChatMessage,
  LlmProvider,
  SttProvider,
  SttUsage,
  SttUsageSource,
  TtsProvider,
} from './providers/types'
import { assembleLlmContext, type GameState } from './manual-injection'
import type { ResolvedConfig } from './provider-config'
import type { ManualData } from './contract'
import { traceTurn } from './trace'

/** Usage counters accumulated across a session (mirrors `SessionSummary.usage`). */
export interface UsageCounters {
  llmInputTokens: number
  llmOutputTokens: number
  sttInputSeconds: number
  ttsOutputSeconds: number
}

/**
 * Audio byte-rate constant. Both the Volcengine ASR input and the Doubao TTS
 * output are PCM 16-bit mono at 16 kHz (the adapter's `DEFAULT_SAMPLE_RATE`),
 * i.e. 16000 samples/s * 2 bytes/sample = 32000 bytes/s.
 *
 * Under that fixed format the byte->seconds conversion is EXACT, not an
 * estimate: the byte count of the actual audio that flowed divides precisely
 * into its duration. For TTS this measures the actual synthesized product
 * (every frame's bytes are tallied as they are yielded); for STT it is the
 * fallback path when the adapter reports no structured usage of its own —
 * metered seconds from this path carry the `derived-from-bytes` annotation.
 */
const PCM16_MONO_16K_BYTES_PER_SECOND = 32000

/** Convert a raw PCM-frame byte count to seconds (exact under the format above). */
function audioSecondsFromBytes(byteLength: number): number {
  return byteLength / PCM16_MONO_16K_BYTES_PER_SECOND
}

/**
 * Mutable per-session state the pipeline reads and updates. Held by the DO;
 * passed by reference into `runTurn` so a completed turn's history + usage carry
 * into the next turn.
 */
export interface SessionState {
  /**
   * Opaque session id attached to structured trace lines so one production voice
   * session can be queried end to end in Workers Logs. This is diagnostic only;
   * it never crosses the provider boundary and does not affect protocol state.
   */
  traceSessionId?: string
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
  /**
   * Aggregate STT metering provenance across the session. Starts
   * `provider-reported` and latches to `derived-from-bytes` as soon as ANY
   * turn's STT seconds came from a byte-rate conversion rather than the
   * provider's own report — the annotation describes the precision floor of
   * the aggregated `sttInputSeconds`, so one fallback turn downgrades the
   * whole session's annotation. Flushed alongside the counters at session end.
   */
  sttSource: SttUsageSource
}

/** The three wired providers a turn drives. */
export interface TurnProviders {
  stt: SttProvider
  llm: LlmProvider
  tts: TtsProvider
}

/**
 * The captured outcome of one utterance's STT phase ({@link runUtteranceStt}),
 * consumed by the reply phase ({@link runReply}). In the live WS transport the
 * DO runs the STT phase on `speech-start` (so interim captions stream WHILE the
 * player speaks) and the reply phase on `turn`, threading this between them.
 */
export interface UtteranceResult {
  /** The player's complete recognized utterance (empty string for no-speech). */
  transcript: string
  /** Total inbound audio bytes the STT provider pulled — the fallback metering source. */
  audioBytes: number
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
 * STT provider instances may expose a structured `lastUsage` after a transcribe
 * stream is drained (the Volcengine adapter does; the mock does on request).
 * Read structurally, mirroring the LLM `lastUsage` pattern, so the pipeline
 * stays adapter-agnostic.
 */
interface MaybeSttUsageProvider {
  lastUsage?: SttUsage
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
 * Drain an STT transcript stream, STREAMING each interim result to the client as
 * a live-subtitle `transcript` chunk (`final: false`, carrying the running
 * cumulative recognized text), and RETURN the player's complete utterance for
 * the turn: the text of the terminal `isFinal` chunk (cumulative ASR semantics).
 * If no `isFinal` (last-package) chunk arrives, fall back to the last chunk's
 * text (best effort), or empty string for an empty stream. A clean no-final ASR
 * close (a benign no-speech turn) surfaces here as that empty/partial transcript
 * rather than a throw, so `runTurn` can skip the turn; only a genuine fault
 * (error frame, connect failure, idle stall) throws out of `transcribe`.
 *
 * The terminal chunk is NOT emitted as an interim here: its text is returned as
 * `transcript` so `runTurn` emits it once as the terminal `final: true` frame
 * after the no-speech gate (an empty utterance is skipped — never surfaced).
 * Interim chunks whose trimmed text is empty are suppressed, so a whitespace-only
 * stream that resolves to a skip emits no frame at all.
 *
 * Also returns `audioBytes`: the total byte length of the inbound audio frames
 * the STT provider actually pulled, tapped via a counting passthrough. The
 * caller uses this as the fallback STT metering path when the adapter exposes
 * no structured usage of its own. The passthrough forwards every frame
 * unchanged, so STT behaviour is unaffected.
 */
async function* collectFinalTranscript(
  stt: SttProvider,
  audio: AsyncIterable<AudioChunk>
): AsyncGenerator<AiResponseChunk, { transcript: string; audioBytes: number }> {
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
    if (chunk.isFinal) {
      // Terminal/last-package result — the complete utterance. Don't stream it as
      // an interim; `runTurn` emits it once as the terminal `final: true` frame
      // (and only when non-empty, preserving the no-speech skip).
      lastFinal = chunk.text
      continue
    }
    // Interim running text — stream it live as a non-final subtitle update. The
    // text is the cumulative recognized-so-far, not a delta.
    if (chunk.text.trim().length > 0) {
      yield { kind: 'transcript', text: chunk.text, final: false, done: false }
    }
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
 * Server-side opening directive for the AI-first greeting turn. This rides as
 * the synthetic `user` message of the opening turn so the LLM has a turn to
 * respond to; it is NEVER client-provided and NEVER persisted into history (the
 * greeting it elicits is). The persona's own language rule (e.g. bombsquad's
 * "always Chinese") governs the greeting language — the directive only sets the
 * INTENT (greet + invite the player to describe what they see), not the words.
 */
export const OPENING_DIRECTIVE =
  '[session start] Open the conversation now. Greet the player warmly in their own ' +
  'language and invite them to describe the current module — what they see on the ' +
  'device in front of them. Keep it to one or two short sentences.'

/** The loop-internal tally a settled LLM+TTS turn reports back to its caller. */
interface LlmTtsResult {
  assistantText: string
  ttsAudioBytes: number
  llmDeltaCount: number
  sentenceCount: number
  ttsFrameCount: number
}

/** Assemble the deterministic server-side system message(s) for a turn. */
function assembleSystem(state: SessionState): ChatMessage[] {
  return assembleLlmContext({
    systemPromptConfig: state.config.systemPromptConfig,
    manualData: state.manualData,
    gameState: state.gameState,
    ...(state.companionContext !== undefined ? { companionContext: state.companionContext } : {}),
  })
}

/** Apply the LLM token usage + TTS output-seconds of a settled turn to state. */
function applyLlmTtsUsage(
  providers: Pick<TurnProviders, 'llm'>,
  state: SessionState,
  result: LlmTtsResult
): { outputTokens?: number } {
  const usage = (providers.llm as MaybeUsageProvider).lastUsage
  if (usage) {
    state.usage.llmInputTokens += usage.inputTokens
    state.usage.llmOutputTokens += usage.outputTokens
  }
  // TTS seconds: exact conversion of the actual synthesized product — the byte
  // tally of every audio frame this turn yielded, under the adapters' fixed
  // PCM16 mono 16 kHz output contract.
  state.usage.ttsOutputSeconds += audioSecondsFromBytes(result.ttsAudioBytes)
  return { outputTokens: usage?.outputTokens }
}

/**
 * Apply a settled turn's STT input-seconds to state. Prefers the adapter's
 * structured usage report (the Volcengine adapter exposes the server's
 * `audio_info.duration` when reported, or its own exact bytes->duration
 * conversion when not). When the adapter exposes nothing at all, falls back to
 * the pipeline's byte tap over the inbound frames the STT provider actually
 * pulled — and latches the session's STT metering annotation to
 * `derived-from-bytes` (see `SessionState.sttSource`).
 */
function applySttUsage(
  providers: Pick<TurnProviders, 'stt'>,
  state: SessionState,
  sttAudioBytes: number
): void {
  const sttUsage = (providers.stt as MaybeSttUsageProvider).lastUsage
  if (sttUsage) {
    state.usage.sttInputSeconds += sttUsage.durationMs / 1000
    if (sttUsage.source === 'derived-from-bytes') state.sttSource = 'derived-from-bytes'
  } else {
    state.usage.sttInputSeconds += audioSecondsFromBytes(sttAudioBytes)
    state.sttSource = 'derived-from-bytes'
  }
}

/**
 * The shared LLM->TTS half of a turn: given the fully-assembled `messages`, run
 * the LLM stream and TTS concurrently and yield the interleaved `text`/`audio`
 * chunks (NO terminal `done` — the caller emits that after its own settle). It
 * is I/O-free beyond driving the injected LLM/TTS providers, and reports the
 * per-turn tally as the generator's return value so the caller can settle usage
 * and history. Reused by both `runTurn` (player-audio turn) and
 * `runOpeningTurn` (the AI-first greeting).
 */
async function* streamLlmTts(
  providers: Pick<TurnProviders, 'llm' | 'tts'>,
  model: string,
  messages: ChatMessage[],
  turnStart: number,
  traceSessionId?: string
): AsyncGenerator<AiResponseChunk, LlmTtsResult> {
  // LLM + TTS run concurrently: the LLM loop segments text into sentences and
  // feeds a queue the TTS provider drains. We interleave text chunks (as the
  // LLM streams) with audio chunks (as TTS produces them).
  const sentenceQueue = new SentenceQueue()
  const ttsIterator = providers.tts.synthesize(sentenceQueue)[Symbol.asyncIterator]()

  // Turn-trace counters for the LLM->TTS boundary (the deploy task's last
  // sighting put the park here). Pure instrumentation: counting + first-event
  // flags only, no effect on what is pushed/yielded or in what order.
  let llmDeltaCount = 0
  let firstDeltaTraced = false
  let sentenceCount = 0
  let firstFrameTraced = false
  let ttsFrameCount = 0
  // Count sentences crossing the LLM->TTS boundary (reported at turn settle).
  // Behaviour-identical to `sentenceQueue.push` (same sentences, same order).
  const queueSentence = (sentence: string): void => {
    sentenceCount += 1
    sentenceQueue.push(sentence)
  }

  let assistantText = ''
  let pending = ''
  let ttsDone = false
  let nextTtsPromise: Promise<IteratorResult<{ audio: Uint8Array; done: boolean }>> | undefined =
    ttsIterator.next()

  const llmStream = providers.llm
    .streamCompletion({
      model,
      messages,
    })
    [Symbol.asyncIterator]()

  let llmDone = false
  let nextLlmPromise: Promise<IteratorResult<{ content: string; done: boolean }>> | undefined =
    llmStream.next()

  // TTS output bytes tallied across the turn's synthesized frames — converted
  // exactly into the TTS output-seconds usage at turn settle (the actual
  // synthesized product, not an estimate).
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
            llmDeltaCount += 1
            if (!firstDeltaTraced) {
              firstDeltaTraced = true
              traceTurn('llm', 'first-delta', {
                sessionId: traceSessionId,
                elapsedMs: Date.now() - turnStart,
              })
            }
            yield { kind: 'text', text: delta, done: false }
          }
          const { sentences, remainder } = splitSentences(pending)
          for (const sentence of sentences) queueSentence(sentence)
          pending = remainder
          const tail = pending.trim()
          if (tail.length > 0) {
            queueSentence(tail)
            pending = ''
          }
          // LLM stream finished and all text has crossed into TTS — the boundary
          // is fully drained. A park AFTER this with no audio isolates TTS.
          traceTurn('llm', 'stream-end', {
            sessionId: traceSessionId,
            deltaCount: llmDeltaCount,
            sentenceCount,
            assistantChars: assistantText.length,
            elapsedMs: Date.now() - turnStart,
          })
          sentenceQueue.close()
        } else {
          const delta = result.value.content
          if (delta.length > 0) {
            assistantText += delta
            pending += delta
            llmDeltaCount += 1
            if (!firstDeltaTraced) {
              firstDeltaTraced = true
              traceTurn('llm', 'first-delta', {
                sessionId: traceSessionId,
                elapsedMs: Date.now() - turnStart,
              })
            }
            yield { kind: 'text', text: delta, done: false }
            const { sentences, remainder } = splitSentences(pending)
            for (const sentence of sentences) queueSentence(sentence)
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
            ttsFrameCount += 1
            if (!firstFrameTraced) {
              firstFrameTraced = true
              traceTurn('tts', 'first-frame', {
                sessionId: traceSessionId,
                frameBytes: result.value.audio.byteLength,
                elapsedMs: Date.now() - turnStart,
              })
            }
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

  return { assistantText, ttsAudioBytes, llmDeltaCount, sentenceCount, ttsFrameCount }
}

/**
 * STT phase of a turn — driven LIVE during the player's utterance.
 *
 * Consumes the inbound audio stream, streaming each interim CUMULATIVE result to
 * the client as a live-subtitle `transcript` chunk (final: false) AS IT ARRIVES,
 * and returns the player's COMPLETE utterance (the terminal last-package result)
 * plus the inbound-frame byte total (the fallback STT metering source). The
 * generator yields ONLY interim frames; the terminal complete utterance is
 * returned, not yielded (the reply phase emits it once as the `final: true`
 * frame, after the no-speech gate).
 *
 * In the live WS transport the DO calls this on `speech-start` over the STILL-OPEN
 * audio bridge, so frames pushed while the player speaks feed the recognizer
 * immediately and the interim captions surface WHILE they talk; the DO closes the
 * bridge on `turn` to terminate the stream and capture the final. A benign
 * no-speech utterance surfaces as an empty/partial transcript (no throw); only a
 * genuine ASR fault throws out of here (fail loud upstream).
 */
export async function* runUtteranceStt(
  providers: Pick<TurnProviders, 'stt'>,
  audio: AsyncIterable<AudioChunk>,
  traceSessionId?: string
): AsyncGenerator<AiResponseChunk, UtteranceResult> {
  const sttStart = Date.now()
  const { transcript, audioBytes } = yield* collectFinalTranscript(providers.stt, audio)
  // ASR hop boundary: the complete cumulative transcript is in hand (length only —
  // never the text). An empty transcript here explains a downstream LLM no-op.
  traceTurn('asr', 'final-transcript', {
    sessionId: traceSessionId,
    transcriptChars: transcript.length,
    elapsedMs: Date.now() - sttStart,
  })
  return { transcript, audioBytes }
}

/**
 * Reply phase of a turn — run on `turn`, after the utterance's STT finalized.
 *
 * Given the captured complete utterance, emits the terminal `transcript`
 * (final: true) frame, assembles the deterministic context, runs LLM+TTS, and
 * settles state (history, turnCount, LLM/TTS/STT usage). Yields the ordered AI
 * reply chunks ending in exactly one terminal `done: true` chunk.
 *
 * The STT stream was already drained by {@link runUtteranceStt}, so
 * `providers.stt.lastUsage` is settled by the time this reads it. Mutates `state`;
 * I/O-free beyond driving the injected LLM/TTS providers.
 */
export async function* runReply(
  providers: TurnProviders,
  state: SessionState,
  utterance: UtteranceResult
): AsyncIterable<AiResponseChunk> {
  const turnStart = Date.now()
  const { transcript: playerText, audioBytes: sttAudioBytes } = utterance

  // Benign no-speech turn: the player's utterance held nothing transcribable (a
  // false-positive VAD trigger — a stopwatch tick, a cough, ambient noise —
  // surfacing as a clean ASR close with no final transcript). Skip the turn: emit
  // NO response chunks, mutate NO state (history, turnCount, usage all untouched),
  // and meter nothing — the player effectively spoke nothing this turn
  // (undercount-only, consistent with the session metering stance). The session
  // stays ready and the next `turn` runs normally. This is NOT an error: a real
  // ASR error frame / connect failure / mid-stream stall throws out of
  // `runUtteranceStt` (fail loud), never reaching here with a transcript.
  if (playerText.trim().length === 0) {
    traceTurn('turn', 'skip-no-speech', {
      sessionId: state.traceSessionId,
      turnCount: state.turnCount,
      elapsedMs: Date.now() - turnStart,
    })
    return
  }

  // The complete utterance — the TERMINAL transcript frame (final: true), surfaced
  // BEFORE the AI reply streams so the client can lock in the live subtitle of
  // what the AI heard. Interim frames (final: false) for this utterance already
  // streamed during the STT phase; this is the single final frame. This is the
  // player's OWN speech returned to that same client — never prompt or secret
  // material; it carries `done: false` (the AI reply's last text chunk is still
  // the turn's terminal `done`).
  yield { kind: 'transcript', text: playerText, final: true, done: false }

  // Inject: deterministic system message (role + rules + manual subset), then the
  // rolling history, then this turn's player utterance.
  const userMessage: ChatMessage = { role: 'user', content: playerText }
  const messages: ChatMessage[] = [...assembleSystem(state), ...state.history, userMessage]

  // LLM + TTS run concurrently via the shared half.
  const result = yield* streamLlmTts(
    providers,
    state.config.llm.model,
    messages,
    turnStart,
    state.traceSessionId
  )

  // Settle turn state: record history, count, and usage; emit the terminal chunk
  // so the consumer can close out the turn.
  state.history.push(userMessage)
  state.history.push({ role: 'assistant', content: result.assistantText })
  state.turnCount += 1

  const { outputTokens } = applyLlmTtsUsage(providers, state, result)
  applySttUsage(providers, state, sttAudioBytes)

  // Turn settle: the per-turn accounting boundary. The counts here are the
  // single most diagnostic line for the silent-park — e.g. llmDeltaCount:0 +
  // ttsFrameCount:0 says nothing flowed past LLM; a high llmDeltaCount with
  // ttsFrameCount:0 isolates TTS at the LLM->TTS boundary.
  traceTurn('turn', 'settle', {
    sessionId: state.traceSessionId,
    turnCount: state.turnCount,
    llmDeltaCount: result.llmDeltaCount,
    llmOutputTokens: outputTokens,
    sentenceCount: result.sentenceCount,
    ttsFrameCount: result.ttsFrameCount,
    ttsAudioBytes: result.ttsAudioBytes,
    elapsedMs: Date.now() - turnStart,
  })

  yield { kind: 'text', text: '', done: true }
}

/**
 * Run one player turn end to end (player audio -> STT -> LLM -> TTS) as the
 * composition of its two phases: {@link runUtteranceStt} (STT, streaming interim
 * captions) then {@link runReply} (LLM+TTS over the captured utterance).
 *
 * This is the BUFFERED single-call form — the live WS transport drives the two
 * phases separately (STT on `speech-start` over the open audio bridge so the
 * caption builds WHILE the player speaks, reply on `turn`), but the end-to-end
 * form keeps the whole pipeline unit-testable with mocked providers and is the
 * canonical primitive exported by the package.
 *
 * Yields the turn's `AiResponseChunk`s in order: interim `transcript` chunks, the
 * terminal `transcript` (final: true), incremental `text` chunks as the LLM
 * streams, `audio` chunks as TTS synthesizes, and exactly one terminal `done`
 * chunk. Mutates `state` (history, turnCount, usage). I/O-free beyond driving the
 * injected providers.
 */
export async function* runTurn(
  providers: TurnProviders,
  state: SessionState,
  audio: AsyncIterable<AudioChunk>
): AsyncIterable<AiResponseChunk> {
  traceTurn('turn', 'pipeline-start', {
    sessionId: state.traceSessionId,
    turnCount: state.turnCount,
  })
  const utterance = yield* runUtteranceStt(providers, audio, state.traceSessionId)
  yield* runReply(providers, state, utterance)
}

/**
 * Server-side closing directive for the post-win recap turn.
 *
 * Seeded as a synthetic `user` message (like `OPENING_DIRECTIVE`) so the LLM
 * has a turn to respond to; NEVER client-provided and NEVER persisted into
 * history (the recap text it elicits is). The persona's own voice rule (spoken
 * Chinese, no brackets/markdown, etc.) governs the reply; this only constrains
 * LENGTH and INTENT so the recap stays short and warm.
 */
export const CLOSING_DIRECTIVE =
  '[game complete] The bomb has been fully defused. ' +
  'In the language you have been speaking (Chinese), congratulate the player warmly in ' +
  'one short sentence, then give a one-sentence spoken recap of the defusal. ' +
  'Two sentences total. Spoken naturally. No lists, no brackets, no markdown.'

/**
 * Run the closing-recap turn — an LLM+TTS-only turn the DO fires after the
 * player wins a daily defuse, with NO player-audio STT step. Mirrors
 * {@link runOpeningTurn}: the server-side {@link CLOSING_DIRECTIVE} stands in
 * for the (absent) player utterance so the LLM speaks a short warm recap before
 * the results screen appears.
 *
 * The synthetic directive is NEVER persisted to history; only the recap text it
 * produces is. The recap does NOT count toward `turnCount` — it is not a player
 * turn. LLM/TTS usage IS metered (the turn consumes real provider resources).
 * I/O-free beyond driving the injected LLM/TTS providers. Mutates `state`
 * (history, LLM/TTS usage).
 */
export async function* runClosingTurn(
  providers: Pick<TurnProviders, 'llm' | 'tts'>,
  state: SessionState
): AsyncIterable<AiResponseChunk> {
  const turnStart = Date.now()
  const userMessage: ChatMessage = { role: 'user', content: CLOSING_DIRECTIVE }
  const messages: ChatMessage[] = [...assembleSystem(state), ...state.history, userMessage]

  const result = yield* streamLlmTts(
    providers,
    state.config.llm.model,
    messages,
    turnStart,
    state.traceSessionId
  )

  // Settle: the closing directive is synthetic and must never leak into history
  // (the recap it elicits is the only thing remembered). turnCount tracks
  // player->AI turns, so the closing recap does not increment it.
  state.history.push({ role: 'assistant', content: result.assistantText })
  const { outputTokens } = applyLlmTtsUsage(providers, state, result)

  traceTurn('turn', 'closing-settle', {
    sessionId: state.traceSessionId,
    turnCount: state.turnCount,
    llmDeltaCount: result.llmDeltaCount,
    llmOutputTokens: outputTokens,
    sentenceCount: result.sentenceCount,
    ttsFrameCount: result.ttsFrameCount,
    ttsAudioBytes: result.ttsAudioBytes,
    elapsedMs: Date.now() - turnStart,
  })

  yield { kind: 'text', text: '', done: true }
}

/**
 * Run the AI-first opening greeting — an LLM+TTS-only turn the DO fires on
 * session establishment, with NO player-audio STT step. The server-side
 * {@link OPENING_DIRECTIVE} stands in for the (absent) player utterance so the
 * LLM opens the conversation in the persona's voice.
 *
 * Yields the same ordered `AiResponseChunk` stream as `runTurn` (text + audio +
 * one terminal `done`), reusing the shared LLM->TTS half. The synthetic
 * directive is NEVER persisted to history (only the greeting it produces is),
 * and the greeting does NOT count toward `turnCount` — it is not a player turn.
 * STT seconds are not metered here (no player audio is consumed). Mutates
 * `state` (history, LLM/TTS usage). I/O-free beyond the injected LLM/TTS
 * providers.
 */
export async function* runOpeningTurn(
  providers: Pick<TurnProviders, 'llm' | 'tts'>,
  state: SessionState
): AsyncIterable<AiResponseChunk> {
  const turnStart = Date.now()
  const userMessage: ChatMessage = { role: 'user', content: OPENING_DIRECTIVE }
  const messages: ChatMessage[] = [...assembleSystem(state), ...state.history, userMessage]

  const result = yield* streamLlmTts(
    providers,
    state.config.llm.model,
    messages,
    turnStart,
    state.traceSessionId
  )

  // Settle. The opening directive is synthetic and must never leak into history
  // (the greeting it elicits is the only thing remembered). turnCount tracks
  // player->AI turns, so the opening greeting does not increment it.
  state.history.push({ role: 'assistant', content: result.assistantText })

  const { outputTokens } = applyLlmTtsUsage(providers, state, result)

  traceTurn('turn', 'opening-settle', {
    sessionId: state.traceSessionId,
    turnCount: state.turnCount,
    llmDeltaCount: result.llmDeltaCount,
    llmOutputTokens: outputTokens,
    sentenceCount: result.sentenceCount,
    ttsFrameCount: result.ttsFrameCount,
    ttsAudioBytes: result.ttsAudioBytes,
    elapsedMs: Date.now() - turnStart,
  })

  yield { kind: 'text', text: '', done: true }
}
