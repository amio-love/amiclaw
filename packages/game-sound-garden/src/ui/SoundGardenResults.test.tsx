import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SoundGardenResults from './SoundGardenResults'

afterEach(cleanup)

const noop = () => undefined

function overlay(props: Partial<Parameters<typeof SoundGardenResults>[0]> = {}) {
  return (
    <SoundGardenResults
      open
      score={9}
      target={8}
      hasNext={false}
      onReplay={noop}
      onNext={noop}
      onExit={noop}
      onDismiss={noop}
      {...props}
    />
  )
}

/** Mirrors GameScreen's gating: a permanently-latched `settled` + per-run dismiss. */
function Harness({ settled }: { settled: boolean }) {
  const [dismissed, setDismissed] = useState(false)
  const [plants, setPlants] = useState(0)
  return (
    <div>
      {/* Garden interaction proxy — must stay usable once the overlay is gone. */}
      <button type="button" onClick={() => setPlants((n) => n + 1)}>
        种一株
      </button>
      <span data-testid="plants">{plants}</span>
      {overlay({ open: settled && !dismissed, onDismiss: () => setDismissed(true) })}
    </div>
  )
}

describe('SoundGardenResults — dismissible settlement overlay (PR-2 §4)', () => {
  it('renders nothing when closed (no scrim over the garden)', () => {
    render(overlay({ open: false }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is dismissible: 继续修剪 and a backdrop tap both fire onDismiss; a card tap does not', () => {
    const onDismiss = vi.fn()
    render(overlay({ onDismiss }))

    // Tapping inside the card must NOT dismiss (stopPropagation).
    fireEvent.click(screen.getByText('🌸 花园绽放了'))
    expect(onDismiss).not.toHaveBeenCalled()

    // The 继续修剪 tertiary action dismisses.
    fireEvent.click(screen.getByText(/继续修剪/))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    // A backdrop (scrim) tap dismisses.
    fireEvent.click(screen.getByRole('dialog'))
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it('after bloom + dismiss, the garden stays interactive and the overlay does not reappear', () => {
    render(<Harness settled />)
    // First bloom → overlay shown.
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Dismiss (继续修剪) → overlay unmounts (no scrim blocking the garden).
    fireEvent.click(screen.getByText(/继续修剪/))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Planting still works after dismissal.
    fireEvent.click(screen.getByText('种一株'))
    fireEvent.click(screen.getByText('种一株'))
    expect(screen.getByTestId('plants').textContent).toBe('2')

    // `settled` stays latched, but the overlay never auto-reopens.
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
