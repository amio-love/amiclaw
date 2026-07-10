import { describe, expect, it } from 'vitest'

import { createRunningState } from '../engine/rules'
import {
  buildShadowChaseVoiceContext,
  buildShadowChaseVoiceState,
  MAX_SHADOW_CHASE_MANUAL_BYTES,
  serializedVoiceManualBytes,
  shadowChaseVoiceStateSignature,
} from './shadow-chase-context'

describe('Shadow Chase voice context', () => {
  it('matches the bounded public-context contract exactly', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.objectives[0].collected = true
    state.actors.companion.status = 'captured'

    const context = buildShadowChaseVoiceContext(state, 'planning', 'split')

    expect(Object.keys(context)).toEqual([
      'version',
      'phase',
      'strategy',
      'allowedStrategies',
      'map',
      'objectives',
      'collectedObjectiveIds',
      'exit',
      'actors',
    ])
    expect(context).toMatchObject({
      version: 1,
      phase: 'planning',
      strategy: 'split',
      allowedStrategies: ['follow', 'split', 'decoy'],
      map: { id: 'courtyard', width: 7, height: 7 },
      collectedObjectiveIds: ['core-aurora'],
      actors: [
        { id: 'player', status: 'free' },
        { id: 'companion', status: 'captured' },
      ],
    })
    expect(context.objectives).toHaveLength(3)
    expect(context.map.walls.length).toBeLessThanOrEqual(64)
    expect(serializedVoiceManualBytes()).toBeLessThanOrEqual(MAX_SHADOW_CHASE_MANUAL_BYTES)
  })

  it('ignores frame-only movement while tracking material game changes', () => {
    const base = createRunningState('crossroads', 'standard', 11)
    const baseline = shadowChaseVoiceStateSignature(
      buildShadowChaseVoiceState(base, 'planning', 'follow')
    )
    const frameOnly = {
      ...base,
      tick: 41,
      actors: {
        ...base.actors,
        player: { ...base.actors.player, position: { x: 3, y: 4 } },
        companion: { ...base.actors.companion, position: { x: 2, y: 7 } },
        pursuer: { ...base.actors.pursuer, position: { x: 8, y: 8 } },
      },
    }

    expect(
      shadowChaseVoiceStateSignature(buildShadowChaseVoiceState(frameOnly, 'planning', 'follow'))
    ).toBe(baseline)
    expect(
      shadowChaseVoiceStateSignature(buildShadowChaseVoiceState(base, 'running', 'follow'))
    ).not.toBe(baseline)
    expect(
      shadowChaseVoiceStateSignature(buildShadowChaseVoiceState(base, 'planning', 'decoy'))
    ).not.toBe(baseline)

    const collected = {
      ...base,
      objectives: base.objectives.map((objective, index) => ({
        ...objective,
        collected: index === 0,
      })),
    }
    expect(
      shadowChaseVoiceStateSignature(buildShadowChaseVoiceState(collected, 'planning', 'follow'))
    ).not.toBe(baseline)
  })
})
