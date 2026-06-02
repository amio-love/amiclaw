import { describe, it, expect } from 'vitest'
import { SFX_PRESETS } from './presets'

describe('SFX presets', () => {
  it('module-success is a distinct tonal chime, not the percussive error sample', () => {
    const success = SFX_PRESETS['module-success']
    const error = SFX_PRESETS['module-error']

    // The whole point of the cue rework: success no longer shares the error's
    // `thunk` sample at a different pitch — it is synthesised as a chime.
    expect(success.kind).toBe('chime')
    expect(error.kind ?? 'sample').toBe('sample')
    if (error.kind === undefined || error.kind === 'sample') {
      expect(error.sample).toBe('thunk')
    }
  })

  it('module-success is a short two-note rising chime, kept restrained', () => {
    const success = SFX_PRESETS['module-success']
    if (success.kind !== 'chime') throw new Error('module-success must be a chime preset')

    expect(success.notes).toHaveLength(2)
    // Rising: each note higher than the last.
    expect(success.notes[1]).toBeGreaterThan(success.notes[0])
    // Restrained: well under the 1.0 full-scale used by percussive feedback.
    expect(success.gain).toBeLessThanOrEqual(0.4)
  })

  it('result-success is a fuller rising chime for the run-end arrival', () => {
    const result = SFX_PRESETS['result-success']
    if (result.kind !== 'chime') throw new Error('result-success must be a chime preset')

    expect(result.notes.length).toBeGreaterThanOrEqual(3)
    // Strictly ascending.
    for (let i = 1; i < result.notes.length; i++) {
      expect(result.notes[i]).toBeGreaterThan(result.notes[i - 1])
    }
    expect(result.gain).toBeLessThanOrEqual(0.4)
  })
})
