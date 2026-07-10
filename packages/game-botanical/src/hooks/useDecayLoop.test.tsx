import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { useDecayLoop } from './useDecayLoop'

function Harness({ onTick, active }: { onTick: (dt: number) => void; active: boolean }) {
  useDecayLoop(onTick, active)
  return null
}

/** Controllable rAF: one pending callback, fired with an explicit timestamp. */
function installFakeRaf() {
  let pending: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    pending = fn
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null
  })
  return (timestamp: number) => {
    const fn = pending
    pending = null
    act(() => fn?.(timestamp))
  }
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

afterEach(() => {
  vi.unstubAllGlobals()
  setHidden(false)
  cleanup()
})

describe('useDecayLoop', () => {
  it('feeds the diffed frame delta to onTick (first frame primes the baseline)', () => {
    const frame = installFakeRaf()
    const seen: number[] = []
    render(<Harness onTick={(dt) => seen.push(dt)} active />)

    frame(1000) // primes last=1000, dt=0 → no tick
    frame(1016) // dt=16
    frame(1050) // dt=34
    expect(seen).toEqual([16, 34])
  })

  it('clamps a large resume gap to the per-frame ceiling', () => {
    const frame = installFakeRaf()
    const seen: number[] = []
    render(<Harness onTick={(dt) => seen.push(dt)} active />)

    frame(1000) // prime
    frame(6000) // dt=5000 → clamped to 1000
    expect(seen).toEqual([1000])
  })

  it('pauses while the tab is hidden and never replays the gap', () => {
    const frame = installFakeRaf()
    const seen: number[] = []
    render(<Harness onTick={(dt) => seen.push(dt)} active />)

    frame(1000) // prime
    frame(1016) // dt=16
    setHidden(true)
    frame(9000) // hidden → no tick, baseline reset
    setHidden(false)
    frame(9016) // re-prime after resume, dt=0
    frame(9032) // dt=16
    expect(seen).toEqual([16, 16])
  })

  it('does not schedule frames while inactive', () => {
    const frame = installFakeRaf()
    const seen: number[] = []
    render(<Harness onTick={(dt) => seen.push(dt)} active={false} />)
    frame(1000)
    frame(2000)
    expect(seen).toEqual([])
  })
})
