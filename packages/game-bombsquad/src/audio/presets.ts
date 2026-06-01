/**
 * Per-operation sound presets. Two preset shapes share one table:
 *
 * - **Sample presets** map an SFX to a base sample plus a `rate`
 *   (couples pitch + speed via Web Audio's AudioBufferSourceNode.playbackRate)
 *   and a `gain` (0..1 linear amplitude on the GainNode). Three shared base
 *   samples cover the percussive UI operations; the bomb detonation has its
 *   own dedicated sample.
 * - **Chime presets** are synthesised live from oscillators — a short
 *   sequence of rising notes. Success cues use these so a win sounds tonal and
 *   bright, clearly apart from the percussive `thunk` an error shares with the
 *   rest of the click family. No extra audio asset is shipped for them.
 *
 * Gain convention: foreground percussive feedback at 1.0 (full sample
 * amplitude, no clipping risk); ambient stopwatch tick at 0.3 so it sits
 * clearly under click feedback in the mix. The detonation also plays at
 * 1.0 — the top of the no-clip range — so it lands as the loudest, most
 * prominent cue, carried further by its intrinsically punchy sample. Chime
 * cues stay deliberately low (~0.3) so the success feedback reads as a clean,
 * restrained beat rather than a fanfare.
 */

import type { SampleName } from './audio-context'

export type SfxType =
  | 'confirm'
  | 'wire-cut'
  | 'dial-rotate'
  | 'keypad-press'
  | 'button-down'
  | 'button-up'
  | 'module-success'
  | 'module-error'
  | 'result-success'
  | 'stopwatch-tick'
  | 'explosion'

/** A one-shot sound built from a decoded audio sample. */
export interface SamplePreset {
  /** Discriminator. Sample playback is the default and may be omitted. */
  kind?: 'sample'
  sample: SampleName
  rate: number
  gain: number
}

/** A one-shot cue synthesised from a short rising oscillator sequence. */
export interface ChimePreset {
  kind: 'chime'
  /** Ascending note frequencies in Hz, played in order. */
  notes: readonly number[]
  /** Oscillator waveform — 'triangle' reads as a soft chime, not a test tone. */
  waveform: OscillatorType
  /** Per-note ring-out duration in seconds. */
  noteDuration: number
  /** Seconds between successive note onsets — below noteDuration for legato. */
  noteStride: number
  /** Peak per-note gain (0..1). Kept low so the cue stays restrained. */
  gain: number
}

export type SfxPreset = SamplePreset | ChimePreset

export const SFX_PRESETS: Record<SfxType, SfxPreset> = {
  confirm: { sample: 'click', rate: 1.0, gain: 1.0 },
  'wire-cut': { sample: 'click', rate: 0.7, gain: 1.0 },
  'dial-rotate': { sample: 'click', rate: 1.3, gain: 1.0 },
  'keypad-press': { sample: 'click', rate: 1.5, gain: 1.0 },
  'button-down': { sample: 'click', rate: 0.85, gain: 1.0 },
  'button-up': { sample: 'click', rate: 1.0, gain: 1.0 },
  // Clearing a module: a short two-note rising chime (E5 → B5, a clean
  // perfect fifth). Tonal and bright, so it never reads as the percussive
  // `thunk` the error cue uses.
  'module-success': {
    kind: 'chime',
    notes: [659.25, 987.77],
    waveform: 'triangle',
    noteDuration: 0.16,
    noteStride: 0.085,
    gain: 0.3,
  },
  'module-error': { sample: 'thunk', rate: 0.65, gain: 1.0 },
  // Finishing the whole run: a three-note rising major triad (E5 → G#5 → B5).
  // A touch fuller than the per-module chime so the result screen feels like
  // an arrival, still short and restrained — not a fanfare.
  'result-success': {
    kind: 'chime',
    notes: [659.25, 830.61, 987.77],
    waveform: 'triangle',
    noteDuration: 0.22,
    noteStride: 0.11,
    gain: 0.28,
  },
  'stopwatch-tick': { sample: 'tick', rate: 1.0, gain: 0.3 },
  explosion: { sample: 'explosion', rate: 1.0, gain: 1.0 },
}
