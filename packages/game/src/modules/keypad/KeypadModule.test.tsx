import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import KeypadModule from './KeypadModule'
import type { KeypadConfig, KeypadAnswer, SceneInfo } from '@shared/manual-schema'

const config: KeypadConfig = {
  symbols: ['omega', 'delta', 'star', 'xi'],
}
const answer: KeypadAnswer = { type: 'keypad', sequence: [0, 1, 2, 3] }
const sceneInfo: SceneInfo = { serialNumber: 'A7K3B2', batteryCount: 2, indicators: [] }

describe('KeypadModule', () => {
  it('calls onComplete after 600ms when symbols are clicked in correct order', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <KeypadModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={sceneInfo} />
    )
    fireEvent.click(screen.getByTestId('keypad-cell-0'))
    fireEvent.click(screen.getByTestId('keypad-cell-1'))
    fireEvent.click(screen.getByTestId('keypad-cell-2'))
    fireEvent.click(screen.getByTestId('keypad-cell-3'))
    expect(onComplete).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(600) })
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('calls onError when symbols are clicked in wrong order', () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <KeypadModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={sceneInfo} />
    )
    fireEvent.click(screen.getByTestId('keypad-cell-3'))
    fireEvent.click(screen.getByTestId('keypad-cell-2'))
    fireEvent.click(screen.getByTestId('keypad-cell-1'))
    fireEvent.click(screen.getByTestId('keypad-cell-0'))
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('ignores clicking the same cell twice', () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <KeypadModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={sceneInfo} />
    )
    fireEvent.click(screen.getByTestId('keypad-cell-0'))
    fireEvent.click(screen.getByTestId('keypad-cell-0'))
    const badges = screen.queryAllByText('1')
    expect(badges).toHaveLength(1)
    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('shows badge "1" after clicking the first cell', () => {
    render(
      <KeypadModule config={config} answer={answer} onComplete={vi.fn()} onError={vi.fn()} sceneInfo={sceneInfo} />
    )
    fireEvent.click(screen.getByTestId('keypad-cell-0'))
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
