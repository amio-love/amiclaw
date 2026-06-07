import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ButtonModule from './ButtonModule'
import type { SceneInfo } from '@shared/manual-schema'

const sceneInfo: SceneInfo = { sceneTongueTwister: '四是四十是十', batteryCount: 2, indicators: [] }

describe('ButtonModule', () => {
  it('calls onComplete after short tap when answer is tap', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const onError = vi.fn()
    const config = { color: 'red', label: 'PRESS', indicatorColor: 'white', displayNumber: 3 }
    const answer = { type: 'button' as const, action: 'tap' as const }
    render(
      <ButtonModule
        config={config}
        answer={answer}
        onComplete={onComplete}
        onError={onError}
        sceneInfo={sceneInfo}
      />
    )
    const btn = screen.getByTestId('big-button')
    fireEvent.pointerDown(btn)
    fireEvent.pointerUp(btn)
    act(() => {
      vi.advanceTimersByTime(600)
    })
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
      <ButtonModule
        config={config}
        answer={answer}
        onComplete={onComplete}
        onError={onError}
        sceneInfo={sceneInfo}
      />
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
      <ButtonModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    expect(screen.getByText('DETONATE')).toBeInTheDocument()
    expect(screen.getByTestId('button-display')).toHaveTextContent('7')
  })
})

describe('ButtonModule cycle-legibility cue is target-agnostic', () => {
  const RELEASE_COLORS = ['white', 'yellow', 'blue', 'red'] as const

  // The indicator pip lives inside the cue-bearing "indicator well" (the
  // element that carries the sweep ring + the .cycling activation class). The
  // well is the pip's parent. Returning its outerHTML captures the FULL cue
  // markup — the well's class set, the pip's class set, and inline styles —
  // which is exactly what a viewer could read off the screen.
  function indicatorWellHtml(): string {
    const well = screen.getByTestId('button-indicator').parentElement
    if (!well) throw new Error('indicator pip has no parent well')
    return well.outerHTML
  }

  // The spec's hardest constraint: for any target color X, the rendered
  // emphasis must be IDENTICAL for every color, so a viewer cannot infer the
  // answer from the screen. We drive a `hold` attempt for each of the four
  // `releaseOnColor` targets into the holding state and advance every render by
  // the SAME number of cycle steps, so all four sit at the same cycle index.
  // The cue markup (ring structure + class sets) must then be byte-identical
  // across all four targets. This fails loudly if anyone later keys the
  // ring/pulse on answer.releaseOnColor (the well/pip class set or structure
  // would then diverge by target).
  it('renders an identical indicator-well cue for every release-on-light target', () => {
    const renderedWells = RELEASE_COLORS.map((releaseOnColor) => {
      vi.useFakeTimers()
      // Hold the per-target inputs (config color / label / preview color) FIXED
      // across all four renders, so the ONLY thing that varies is the answer's
      // release target. That isolates the leak: any difference in the captured
      // cue markup must originate from the target color, which is the leak.
      const config = { color: 'red', label: 'PRESS', indicatorColor: 'white', displayNumber: 3 }
      const answer = { type: 'button' as const, action: 'hold' as const, releaseOnColor }
      const { unmount } = render(
        <ButtonModule
          config={config}
          answer={answer}
          onComplete={vi.fn()}
          onError={vi.fn()}
          sceneInfo={sceneInfo}
        />
      )
      const btn = screen.getByTestId('big-button')
      // Press, cross the hold threshold to enter the holding/cycling state, then
      // advance two full cycle steps so every target lands on the same index.
      fireEvent.pointerDown(btn)
      act(() => {
        vi.advanceTimersByTime(500) // HOLD_THRESHOLD_MS -> holding
        vi.advanceTimersByTime(800 * 2) // INDICATOR_CYCLE_MS * 2 -> same index
      })
      const html = indicatorWellHtml()
      unmount()
      vi.useRealTimers()
      return html
    })

    // Sanity: the cue must actually be present (guards against an empty-string
    // tautology where every well happens to be identically blank).
    expect(renderedWells[0]).toContain('button-indicator')
    expect(renderedWells[0].length).toBeGreaterThan(0)

    // Every target's cue markup must equal white's — identical for all colors.
    for (let i = 1; i < RELEASE_COLORS.length; i++) {
      expect(
        renderedWells[i],
        `cue markup for releaseOnColor="${RELEASE_COLORS[i]}" differs from "white" — the cue leaks the target`
      ).toBe(renderedWells[0])
    }
    // Collapsing to a unique set must yield exactly one variant.
    expect(new Set(renderedWells).size).toBe(1)
  })

  it('marks the indicator well as cycling only while holding (not idle or pressed)', () => {
    vi.useFakeTimers()
    const config = { color: 'blue', label: 'ABORT', indicatorColor: 'red', displayNumber: 1 }
    const answer = { type: 'button' as const, action: 'hold' as const, releaseOnColor: 'yellow' }
    render(
      <ButtonModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    const btn = screen.getByTestId('big-button')
    const wellTestId = 'button-indicator' // pip parent carries the cycling class

    // The .cycling class is the well's class minus the pip's class. We read the
    // well's classList directly off the pip's parent.
    const wellClasses = () => {
      const well = screen.getByTestId(wellTestId).parentElement
      if (!well) throw new Error('indicator pip has no parent well')
      return Array.from(well.classList)
    }
    const isCycling = () => wellClasses().some((c) => c.toLowerCase().includes('cycling'))

    // idle: not cycling.
    expect(isCycling(), 'must not be cycling in idle state').toBe(false)

    // pressed (before the hold threshold): still not cycling.
    fireEvent.pointerDown(btn)
    expect(isCycling(), 'must not be cycling in pressed state').toBe(false)

    // holding (after the hold threshold): now cycling.
    act(() => {
      vi.advanceTimersByTime(500) // HOLD_THRESHOLD_MS -> holding
    })
    expect(isCycling(), 'must be cycling in holding state').toBe(true)

    vi.useRealTimers()
  })
})
