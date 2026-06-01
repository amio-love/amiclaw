import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import WireModule from './WireModule'
import styles from './WireModule.module.css'

const config = {
  wires: [
    { color: 'red' as const },
    { color: 'blue' as const },
    { color: 'yellow' as const },
    { color: 'green' as const },
  ],
}
const answer = { type: 'wire' as const, cutPosition: 2 }
const sceneInfo = { sceneTongueTwister: '四是四十是十', batteryCount: 2, indicators: [] as [] }

describe('WireModule', () => {
  it('calls onComplete when correct wire is clicked', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <WireModule
        config={config}
        answer={answer}
        onComplete={onComplete}
        onError={onError}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('wire-2'))
    vi.advanceTimersByTime(800)
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('calls onError when wrong wire is clicked', () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <WireModule
        config={config}
        answer={answer}
        onComplete={onComplete}
        onError={onError}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('wire-0'))
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('flashes the clicked strand red and keeps it intact on a wrong cut', () => {
    vi.useFakeTimers()
    render(
      <WireModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    // answer.cutPosition is 2 — cutting wire 0 is wrong.
    fireEvent.click(screen.getByTestId('wire-0'))
    const wrong = screen.getByTestId('strand-0')
    // Error treatment is applied to the clicked strand...
    expect(wrong).toHaveClass(styles.strandError)
    // ...and it stays INTACT (still a strand, not severed into cut halves).
    expect(wrong).toBeInTheDocument()
    // A different strand is untouched.
    expect(screen.getByTestId('strand-1')).not.toHaveClass(styles.strandError)
    // The error treatment clears when the panel resets to idle (~600ms).
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByTestId('strand-0')).not.toHaveClass(styles.strandError)
    vi.useRealTimers()
  })

  it('severs the strand and applies no error treatment on a correct cut', () => {
    render(
      <WireModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('wire-2'))
    // Correct cut severs strand 2 — the intact strand path is gone.
    expect(screen.queryByTestId('strand-2')).not.toBeInTheDocument()
    // No strand carries the wrong-cut error treatment.
    expect(screen.getByTestId('strand-0')).not.toHaveClass(styles.strandError)
    expect(screen.getByTestId('strand-1')).not.toHaveClass(styles.strandError)
  })

  it('renders correct number of wire hit targets', () => {
    render(
      <WireModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    expect(screen.getByTestId('wire-0')).toBeInTheDocument()
    expect(screen.getByTestId('wire-1')).toBeInTheDocument()
    expect(screen.getByTestId('wire-2')).toBeInTheDocument()
    expect(screen.getByTestId('wire-3')).toBeInTheDocument()
  })
})
