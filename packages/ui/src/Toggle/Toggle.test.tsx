/**
 * Toggle unit tests — the controlled on/off switch.
 *
 * Guards the accessibility contract (role="switch" + aria-checked reflecting
 * state + the label as the accessible name) and the controlled-flip behaviour
 * (clicking calls onChange with the negated value; a disabled switch does not).
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Toggle from './Toggle'

describe('Toggle', () => {
  it('exposes a switch role with aria-checked tracking the state', () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} label="画像开关" />)
    const sw = screen.getByRole('switch', { name: '画像开关' })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    rerender(<Toggle checked={true} onChange={() => {}} label="画像开关" />)
    expect(screen.getByRole('switch', { name: '画像开关' })).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange with the negated value on click', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="画像开关" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn()
    render(<Toggle checked={true} onChange={onChange} label="画像开关" disabled />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
