import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createRunningState } from '../engine/rules'
import { Hud } from './Hud'

describe('pacing feedback', () => {
  it('shows the remaining core count and available swap charges', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.objectives[0].collected = true
    state.swapCharges = 1

    render(<Hud state={state} />)

    expect(screen.getByText('还需收集 2 枚光核')).toBeTruthy()
    expect(screen.getByText('1 次')).toBeTruthy()
  })

  it('shows the deterministic moon-gate countdown after all cores are collected early', () => {
    const state = createRunningState('courtyard', 'relaxed', 7)
    state.tick = 100
    state.objectives.forEach((objective) => {
      objective.collected = true
    })
    state.exit.enabled = false
    render(<Hud state={state} />)
    expect(screen.getByText('01:35 后开启')).toBeTruthy()
  })

  it('makes a rescue and immediate recapture visible', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.tick = 10
    state.actors.player.status = 'captured'
    state.actors.player.rescueDeadlineTick = 30
    state.eventLog.push({ tick: 8, type: 'rescue', actorId: 'player' })

    render(<Hud state={state} />)

    expect(screen.getByText('你再次被捕 · 5 秒')).toBeTruthy()
  })
})
