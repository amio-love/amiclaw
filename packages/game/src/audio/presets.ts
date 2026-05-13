/**
 * Per-operation sound presets — each SFX type maps to a base sample plus a
 * `playbackRate` (couples pitch + speed via Web Audio's
 * AudioBufferSourceNode.playbackRate) and a `gain` (0..1 linear amplitude
 * on the GainNode). Three base samples cover nine operations, giving
 * distinct but family-related feedback per action.
 *
 * Gain convention: foreground action feedback at 1.0 (full sample
 * amplitude, no clipping risk); ambient stopwatch tick at 0.3 so it sits
 * clearly under click feedback in the mix.
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
  | 'stopwatch-tick'

export interface SfxPreset {
  sample: SampleName
  rate: number
  gain: number
}

export const SFX_PRESETS: Record<SfxType, SfxPreset> = {
  confirm: { sample: 'click', rate: 1.0, gain: 1.0 },
  'wire-cut': { sample: 'click', rate: 0.7, gain: 1.0 },
  'dial-rotate': { sample: 'click', rate: 1.3, gain: 1.0 },
  'keypad-press': { sample: 'click', rate: 1.5, gain: 1.0 },
  'button-down': { sample: 'click', rate: 0.85, gain: 1.0 },
  'button-up': { sample: 'click', rate: 1.0, gain: 1.0 },
  'module-success': { sample: 'thunk', rate: 1.3, gain: 1.0 },
  'module-error': { sample: 'thunk', rate: 0.65, gain: 1.0 },
  'stopwatch-tick': { sample: 'tick', rate: 1.0, gain: 0.3 },
}
