import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import WireModule from './WireModule'

const config = {
  wires: [
    { color: 'red' as const, hasStripe: false },
    { color: 'blue' as const, hasStripe: false },
    { color: 'yellow' as const, hasStripe: false },
    { color: 'green' as const, hasStripe: false },
  ],
}
const answer = { type: 'wire' as const, cutPosition: 2 }
const sceneInfo = { serialNumber: 'A7K3B2', batteryCount: 2, indicators: [] as [] }

describe('WireModule', () => {
  it('calls onComplete when correct wire is clicked', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    render(
      <WireModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={sceneInfo} />
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
      <WireModule config={config} answer={answer} onComplete={onComplete} onError={onError} sceneInfo={sceneInfo} />
    )
    fireEvent.click(screen.getByTestId('wire-0'))
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('renders correct number of wire hit targets', () => {
    render(
      <WireModule config={config} answer={answer} onComplete={vi.fn()} onError={vi.fn()} sceneInfo={sceneInfo} />
    )
    expect(screen.getByTestId('wire-0')).toBeInTheDocument()
    expect(screen.getByTestId('wire-1')).toBeInTheDocument()
    expect(screen.getByTestId('wire-2')).toBeInTheDocument()
    expect(screen.getByTestId('wire-3')).toBeInTheDocument()
  })
})
