import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FeaturedShadowChase from './FeaturedShadowChase'

describe('FeaturedShadowChase', () => {
  it('exposes the solo companion game entry and its Arcade boundary', () => {
    render(<FeaturedShadowChase />)

    expect(screen.getByRole('heading', { name: 'Dual Shadow Chase' })).toBeInTheDocument()
    expect(screen.getByText(/one human \+ one AI companion/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start the chase' })).toHaveAttribute(
      'href',
      '/shadow-chase/'
    )
  })
})
