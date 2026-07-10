import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createRunningState } from '../engine/rules'
import { Hud } from './Hud'

describe('pacing feedback', () => {
  it('shows the deterministic moon-gate countdown after all cores are collected early', () => {
    const state = createRunningState('courtyard', 'relaxed', 7)
    state.tick = 100
    state.objectives.forEach((objective) => {
      objective.collected = true
    })
    state.exit.enabled = false
    render(<Hud state={state} />)
    expect(screen.getByText('Opens in 01:35')).toBeTruthy()
  })
})
