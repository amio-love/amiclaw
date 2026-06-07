import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DialModule from './DialModule'
import type { DialConfig, DialAnswer } from '@shared/manual-schema'

const config: DialConfig = {
  dials: [
    ['omega', 'psi', 'star', 'delta', 'xi', 'diamond'],
    ['psi', 'diamond', 'omega', 'star', 'xi', 'delta'],
    ['star', 'xi', 'delta', 'psi', 'diamond', 'omega'],
  ],
  currentPositions: [0, 0, 0],
}
const answer: DialAnswer = { type: 'dial', positions: [0, 0, 0] }
const sceneInfo = { sceneTongueTwister: '四是四十是十', batteryCount: 2, indicators: [] as [] }

describe('DialModule', () => {
  it('rotating a dial right does not throw and updates state', () => {
    render(
      <DialModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('dial-0-right'))
    expect(screen.getByTestId('dial-0')).toBeInTheDocument()
  })

  it('clicking Confirm with wrong positions calls onError', () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <DialModule
        config={config}
        answer={answer}
        onComplete={onComplete}
        onError={onError}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('dial-0-right'))
    fireEvent.click(screen.getByTestId('dial-confirm'))
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('clicking Confirm with correct positions calls onComplete', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <DialModule
        config={config}
        answer={answer}
        onComplete={onComplete}
        onError={onError}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('dial-confirm'))
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('step reading starts at 0 and tracks right (+1) / left (-1) like the position', () => {
    render(
      <DialModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    const reading = screen.getByTestId('dial-0-steps')
    // Reading is 0-indexed: it equals the number of right presses from the start.
    expect(reading).toHaveTextContent('0')
    fireEvent.click(screen.getByTestId('dial-0-right'))
    expect(reading).toHaveTextContent('1')
    fireEvent.click(screen.getByTestId('dial-0-right'))
    expect(reading).toHaveTextContent('2')
    fireEvent.click(screen.getByTestId('dial-0-left'))
    expect(reading).toHaveTextContent('1')
    // Left past the start wraps with the position (mod 6): 0 -> 5.
    fireEvent.click(screen.getByTestId('dial-0-left'))
    fireEvent.click(screen.getByTestId('dial-0-left'))
    expect(reading).toHaveTextContent('5')
  })

  it('each dial has its own independent step reading', () => {
    render(
      <DialModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('dial-1-right'))
    expect(screen.getByTestId('dial-0-steps')).toHaveTextContent('0')
    expect(screen.getByTestId('dial-1-steps')).toHaveTextContent('1')
    expect(screen.getByTestId('dial-2-steps')).toHaveTextContent('0')
  })

  it('Confirm resets positions after error', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <DialModule
        config={config}
        answer={answer}
        onComplete={onComplete}
        onError={onError}
        sceneInfo={sceneInfo}
      />
    )
    fireEvent.click(screen.getByTestId('dial-0-right'))
    fireEvent.click(screen.getByTestId('dial-confirm'))
    expect(onError).toHaveBeenCalledOnce()
    act(() => {
      vi.advanceTimersByTime(600)
    })
    fireEvent.click(screen.getByTestId('dial-confirm'))
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(onComplete).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
