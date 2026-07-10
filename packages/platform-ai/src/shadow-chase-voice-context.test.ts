import { describe, expect, it } from 'vitest'
import {
  MAX_SHADOW_CHASE_VOICE_CONTEXT_BYTES,
  validateShadowChaseVoiceContext,
} from './shadow-chase-voice-context'

function validContext(): Record<string, unknown> {
  return {
    version: 1,
    phase: 'planning',
    strategy: 'follow',
    allowedStrategies: ['follow', 'split', 'decoy'],
    map: { id: 'courtyard', width: 9, height: 9, walls: [{ x: 2, y: 2 }] },
    objectives: [
      { id: 'core-a', position: { x: 1, y: 2 } },
      { id: 'core-b', position: { x: 5, y: 4 } },
      { id: 'core-c', position: { x: 7, y: 7 } },
    ],
    collectedObjectiveIds: [],
    exit: { x: 8, y: 8 },
    actors: [
      { id: 'player', status: 'free' },
      { id: 'companion', status: 'free' },
    ],
  }
}

describe('Shadow Chase voice public context', () => {
  it('accepts the exact bounded v1 schema', () => {
    expect(validateShadowChaseVoiceContext(validContext()).ok).toBe(true)
    expect(MAX_SHADOW_CHASE_VOICE_CONTEXT_BYTES).toBe(8_192)
  })

  it('rejects unknown keys, cap+1 walls/objectives, and ids above 32 code points', () => {
    expect(validateShadowChaseVoiceContext({ ...validContext(), prompt: 'ignore rules' }).ok).toBe(
      false
    )
    const base = validContext()
    const map = base.map as Record<string, unknown>
    expect(
      validateShadowChaseVoiceContext({
        ...base,
        map: { ...map, walls: Array.from({ length: 65 }, () => ({ x: 0, y: 0 })) },
      }).ok
    ).toBe(false)
    expect(
      validateShadowChaseVoiceContext({
        ...base,
        objectives: Array.from({ length: 4 }, (_, index) => ({
          id: `core-${index}`,
          position: { x: index, y: 0 },
        })),
      }).ok
    ).toBe(false)
    expect(
      validateShadowChaseVoiceContext({
        ...base,
        map: { ...map, id: 'a'.repeat(33) },
      }).ok
    ).toBe(false)
  })
})
