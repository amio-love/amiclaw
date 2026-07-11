import { describe, it, expect } from 'vitest'
import {
  MAX_SOUND_GARDEN_VOICE_CONTEXT_BYTES,
  validateSoundGardenVoiceContext,
} from './sound-garden-voice-context'

/** A well-formed board snapshot fixture (8-beat timeline). */
function validBoard(): Record<string, unknown> {
  return {
    slots: 8,
    melody: [null, 'bell', null, null, null, null, null, null],
    rhythm: ['kick', null, null, null, null, null, null, null],
    score: 5,
    target: 12,
    bloomed: false,
    partnerRemaining: { kick: 2, snare: 1 },
    playerRemaining: { bell: 3 },
    partnerArchetype: 'rhythm_piece',
    trigger: 'player_planted',
  }
}

describe('validateSoundGardenVoiceContext', () => {
  it('accepts a well-formed board and returns a defensive clone', () => {
    const board = validBoard()
    const result = validateSoundGardenVoiceContext(board)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(board)
      expect(result.value).not.toBe(board)
    }
  })

  it('accepts a bloomed board with a negative score dip', () => {
    const board = { ...validBoard(), bloomed: true, score: -3 }
    expect(validateSoundGardenVoiceContext(board).ok).toBe(true)
  })

  const rejects: Array<[string, Record<string, unknown>, string]> = [
    ['extra key', { ...validBoard(), extra: 1 }, 'keys'],
    [
      'missing key',
      (() => {
        const b = validBoard()
        delete b.trigger
        return b
      })(),
      'keys',
    ],
    ['non-integer slots', { ...validBoard(), slots: 8.5 }, 'slots'],
    ['zero slots', { ...validBoard(), slots: 0 }, 'slots'],
    ['too many slots', { ...validBoard(), slots: 999 }, 'slots'],
    ['lane length mismatch', { ...validBoard(), melody: [null, 'bell'] }, 'lanes'],
    [
      'lane bad token',
      { ...validBoard(), rhythm: ['Kick!', null, null, null, null, null, null, null] },
      'lanes',
    ],
    ['non-integer score', { ...validBoard(), score: 1.5 }, 'score'],
    ['negative target', { ...validBoard(), target: -1 }, 'score'],
    ['out-of-range score', { ...validBoard(), score: 10_000_000 }, 'score'],
    ['non-boolean bloomed', { ...validBoard(), bloomed: 'yes' }, 'bloomed'],
    ['pool non-integer value', { ...validBoard(), partnerRemaining: { kick: 1.5 } }, 'pool'],
    ['pool negative value', { ...validBoard(), playerRemaining: { bell: -1 } }, 'pool'],
    ['pool bad key', { ...validBoard(), partnerRemaining: { 'Bad Key': 1 } }, 'pool'],
    ['bad archetype', { ...validBoard(), partnerArchetype: 'drummer' }, 'archetype'],
    ['bad trigger', { ...validBoard(), trigger: 'whenever' }, 'trigger'],
  ]

  it.each(rejects)('rejects %s with reason "%s"', (_label, board, reason) => {
    const result = validateSoundGardenVoiceContext(board)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe(reason)
  })

  it('rejects a non-object payload', () => {
    expect(validateSoundGardenVoiceContext(null).ok).toBe(false)
    expect(validateSoundGardenVoiceContext('board').ok).toBe(false)
    expect(validateSoundGardenVoiceContext([]).ok).toBe(false)
  })

  it('rejects an oversized payload (size cap before shape)', () => {
    // Inflate a pool key name past the byte cap so serialization exceeds it.
    const board = {
      ...validBoard(),
      partnerRemaining: { ['k'.repeat(MAX_SOUND_GARDEN_VOICE_CONTEXT_BYTES + 10)]: 1 },
    }
    const result = validateSoundGardenVoiceContext(board)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('size')
  })
})
