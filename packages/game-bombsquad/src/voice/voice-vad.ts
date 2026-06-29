/**
 * Pure client-side voice-activity detection (VAD) for the hands-free BombSquad
 * voice session. Side-effect-free (no Web Audio, no React) so the turn-boundary
 * state machine is unit-testable by feeding it a sequence of frame energies.
 *
 * Role (load-bearing): the deployed `@amiclaw/platform-ai` server runs each
 * client `turn` as a real, SERIAL STT->LLM->TTS turn and rejects an overlapping
 * one with `turn_in_flight` (see `session-do.ts`). So this VAD gates three CLIENT
 * concerns off the same frame stream:
 *  1. the end-of-utterance turn send — `utterance-end` is when the hook may hand
 *     the buffered audio to the server (the hook additionally suppresses the send
 *     while the AI holds the floor, so a leaked tick / the AI's own voice cannot
 *     race the server's in-flight turn);
 *  2. the 3-state conversation indicator — `speech-start` flips the UI to
 *     "listening", `utterance-end` flips it to "thinking" while the AI replies;
 *  3. barge-in — `speech-start` while the AI is speaking stops local playback.
 *
 * The detector is a small pure reducer: `vadStep(state, rms, frameMs, config)`
 * folds one analyzed frame's RMS into the running state and emits at most one
 * boundary event. The hook owns the Web Audio side (computing RMS per capture
 * frame and reacting to the events); this module only does the math + the state
 * transition, so it can be exhaustively tested with plain number sequences.
 */

/** Tunable VAD parameters. All durations in milliseconds; RMS is in [0, 1]. */
export interface VadConfig {
  /** A frame whose RMS is at or above this is "speech"; below is "silence". */
  speechThreshold: number
  /**
   * Trailing silence (after a qualified utterance) that marks end-of-utterance.
   * Long enough that a natural mid-sentence pause does not split a turn.
   */
  silenceHangoverMs: number
  /**
   * Minimum CONTIGUOUS speech before a run counts as a real utterance. Debounces
   * a single noise blip into nothing — a brief spike followed by silence never
   * reaches this and is discarded.
   */
  minSpeechMs: number
}

/**
 * Default thresholds — deliberately conservative so brief, loud transients
 * (the stopwatch tick, UI clicks, a door slam) and ambient room noise do NOT
 * start an utterance. Two knobs do the work:
 *  - `speechThreshold: 0.07` — a stopwatch tick / ambient hum sits well under
 *    this, while real near-mic speech RMS lands ~0.1–0.3. (The old 0.02 floor
 *    let a tick + room tone read as speech, false-triggering turns.)
 *  - `minSpeechMs: 400` — a real utterance must hold the floor for ≥400ms of
 *    CONTIGUOUS above-threshold energy; a single tick frame (one capture frame
 *    is 256ms at 16 kHz) can never reach it and is discarded by the debounce.
 *
 * These are a STARTING point, not a final tuning: the silence floor and speech
 * level vary with hardware, AGC, and room noise, so they want a real-device
 * pass (flagged). They live here, in one place, so re-tuning is a single edit.
 */
export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechThreshold: 0.07,
  // 2500ms of trailing silence before an utterance is considered finished. A
  // long pause so the player can think and gather their words mid-sentence
  // without the turn firing prematurely (a defuse player describes a device, then
  // pauses to read the next part). Tunable per device feedback.
  silenceHangoverMs: 2500,
  minSpeechMs: 400,
}

/** Running detector state. Reset to `initialVadState` per session / per capture. */
export interface VadState {
  /** True while a qualified utterance is in progress (past `minSpeechMs`). */
  speaking: boolean
  /** Cumulative contiguous speech in the current (forming) utterance. */
  speechMs: number
  /** Trailing silence accumulated since the last speech frame. */
  silenceMs: number
}

export const initialVadState: VadState = { speaking: false, speechMs: 0, silenceMs: 0 }

/** At most one boundary event per analyzed frame. */
export type VadEvent = 'speech-start' | 'utterance-end' | null

export interface VadStepResult {
  state: VadState
  event: VadEvent
}

/**
 * Root-mean-square amplitude of a mono Float32 frame (range [0, 1] for samples in
 * [-1, 1]) — the energy proxy the VAD thresholds against. Rate-independent, so it
 * is computed on the raw capture frame regardless of the context sample rate.
 * An empty frame is silent (0).
 */
export function computeRms(frame: Float32Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i += 1) {
    const s = frame[i]
    sum += s * s
  }
  return Math.sqrt(sum / frame.length)
}

/**
 * Fold one frame's RMS into the detector state, emitting a boundary event when a
 * qualified utterance starts (`speech-start`, once `minSpeechMs` of contiguous
 * speech is reached) or ends (`utterance-end`, after `silenceHangoverMs` of
 * trailing silence). Pure and total: every (state, rms) maps to a defined next
 * state. `frameMs` is the analyzed frame's wall-clock duration
 * (`bufferSize / sampleRate`), passed per step so the detector is sample-rate
 * agnostic.
 */
export function vadStep(
  state: VadState,
  rms: number,
  frameMs: number,
  config: VadConfig
): VadStepResult {
  const isSpeech = rms >= config.speechThreshold
  let { speaking, speechMs, silenceMs } = state
  let event: VadEvent = null

  if (isSpeech) {
    silenceMs = 0
    speechMs += frameMs
    if (!speaking && speechMs >= config.minSpeechMs) {
      speaking = true
      event = 'speech-start'
    }
  } else if (speaking) {
    // Inside a live utterance: short pauses are tolerated; only sustained
    // silence (>= hangover) ends it.
    silenceMs += frameMs
    if (silenceMs >= config.silenceHangoverMs) {
      speaking = false
      speechMs = 0
      silenceMs = 0
      event = 'utterance-end'
    }
  } else {
    // Not yet a qualified utterance and this frame is silence: discard any
    // partial speech so a brief blip cannot accumulate into a spurious utterance
    // across long gaps (the noise debounce — speech must be contiguous to count).
    speechMs = 0
    silenceMs = 0
  }

  return { state: { speaking, speechMs, silenceMs }, event }
}
