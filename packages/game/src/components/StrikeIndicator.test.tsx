import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StrikeIndicator from './StrikeIndicator'

describe('StrikeIndicator', () => {
  it('always renders three pips', () => {
    render(<StrikeIndicator strikeCount={0} />)
    expect(screen.getAllByTestId('strike-pip')).toHaveLength(3)
  })

  it('lights one pip per strike — two strikes light exactly two', () => {
    render(<StrikeIndicator strikeCount={2} />)
    const pips = screen.getAllByTestId('strike-pip')
    const lit = pips.filter((p) => p.getAttribute('data-lit') === 'true')
    expect(lit).toHaveLength(2)
    expect(screen.getByLabelText('失误 2 / 3')).toBeInTheDocument()
  })

  it('lights no pips at zero strikes', () => {
    render(<StrikeIndicator strikeCount={0} />)
    const pips = screen.getAllByTestId('strike-pip')
    expect(pips.filter((p) => p.getAttribute('data-lit') === 'true')).toHaveLength(0)
  })

  it('clamps an over-count to three lit pips', () => {
    render(<StrikeIndicator strikeCount={5} />)
    const pips = screen.getAllByTestId('strike-pip')
    expect(pips.filter((p) => p.getAttribute('data-lit') === 'true')).toHaveLength(3)
  })
})
