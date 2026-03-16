import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ButtonModule from './ButtonModule'
import type { SceneInfo } from '@shared/manual-schema'

const sceneInfo: SceneInfo = { serialNumber: 'A7K3B2', batteryCount: 2, indicators: [] }

describe('ButtonModule', () => {
  it('calls onComplete after short tap when answer is tap', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    const config = { color: 'red', label: 'PRESS', indicatorColor: 'white', displayNumber: 3 }
    const answer = { type: 'button' as const, action: 'tap' as const }
    render(
      <ButtonModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={sceneInfo} />
    )
    const btn = screen.getByTestId('big-button')
    fireEvent.pointerDown(btn)
    fireEvent.pointerUp(btn)
    act(() => { vi.advanceTimersByTime(600) })
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('calls onError on short tap when answer is hold', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    const config = { color: 'blue', label: 'ABORT', indicatorColor: 'red', displayNumber: 1 }
    const answer = { type: 'button' as const, action: 'hold' as const, releaseOnColor: 'white' }
    render(
      <ButtonModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={sceneInfo} />
    )
    const btn = screen.getByTestId('big-button')
    fireEvent.pointerDown(btn)
    fireEvent.pointerUp(btn)
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('renders the button label and display number', () => {
    const config = { color: 'yellow', label: 'DETONATE', indicatorColor: 'blue', displayNumber: 7 }
    const answer = { type: 'button' as const, action: 'tap' as const }
    render(
      <ButtonModule config={config} answer={answer} onComplete={vi.fn()} onError={vi.fn()} sceneInfo={sceneInfo} />
    )
    expect(screen.getByText('DETONATE')).toBeInTheDocument()
    expect(screen.getByTestId('button-display')).toHaveTextContent('7')
  })
})
