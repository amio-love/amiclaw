/**
 * Per-operation sound presets — each SFX type maps to a base sample plus a
 * `playbackRate` that couples pitch + speed via Web Audio's
 * AudioBufferSourceNode.playbackRate. Three base samples cover nine
 * operations, giving distinct but family-related feedback per action.
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
}

export const SFX_PRESETS: Record<SfxType, SfxPreset> = {
  confirm: { sample: 'click', rate: 1.0 },
  'wire-cut': { sample: 'click', rate: 0.7 },
  'dial-rotate': { sample: 'click', rate: 1.3 },
  'keypad-press': { sample: 'click', rate: 1.5 },
  'button-down': { sample: 'click', rate: 0.85 },
  'button-up': { sample: 'click', rate: 1.0 },
  'module-success': { sample: 'thunk', rate: 1.3 },
  'module-error': { sample: 'thunk', rate: 0.65 },
  'stopwatch-tick': { sample: 'tick', rate: 1.0 },
}
