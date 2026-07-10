import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Disclosure from './Disclosure'

/**
 * Disclosure — the shared progressive-disclosure affordance (rc §3). The detail
 * is hidden by default (relocated, not deleted) and revealed on demand via the
 * ⓘ toggle. The toggle carries an accessible name and `aria-expanded`.
 */
describe('Disclosure', () => {
  it('hides the detail by default and reveals it when the ⓘ is toggled', () => {
    render(<Disclosure label="连续打卡说明">最长 4 天 · 匿名记录只在这台设备</Disclosure>)

    const toggle = screen.getByRole('button', { name: '连续打卡说明' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/最长 4 天/)).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/最长 4 天/)).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/最长 4 天/)).not.toBeInTheDocument()
  })

  it('links the toggle to the panel via aria-controls', () => {
    render(<Disclosure label="说明">detail body</Disclosure>)
    const toggle = screen.getByRole('button', { name: '说明' })
    fireEvent.click(toggle)
    const controls = toggle.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls as string)).toHaveTextContent('detail body')
  })
})
