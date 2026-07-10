import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('playable shell semantics', () => {
  it('states the complete rule and enters a run with one primary action', () => {
    render(<App />)
    expect(screen.getByText(/Collect three light cores/i)).toBeTruthy()
    expect(screen.getByText(/leave together/i)).toBeTruthy()
    expect(screen.getByText(/rescue/i)).toBeTruthy()
    expect(screen.getByText(/first 5 seconds are a head start/i)).toBeTruthy()
    expect(screen.getByText(/moon gate opens at 02:00/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /start chase/i }))
    expect(screen.getByRole('application', { name: /dual shadow chase board/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /swap positions/i })).toBeTruthy()
  })

  it('exposes keyboard-friendly command controls', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /start chase/i }))
    for (const name of [/follow/i, /split/i, /decoy/i]) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).not.toBeNull()
    }
  })
})
