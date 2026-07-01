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

  it('exposes concise button color, label, display, and light state to assistive tech', () => {
    const config = { color: 'white', label: 'ABORT', indicatorColor: 'blue', displayNumber: 4 }
    const answer = { type: 'button' as const, action: 'hold' as const, releaseOnColor: 'red' }
    render(
      <ButtonModule
        config={config}
        answer={answer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    const btn = screen.getByRole('button', { name: 'white ABORT button, display 4' })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAccessibleDescription('Preview light is blue.')
  })
})

describe('ButtonModule release-strip cue is target-agnostic', () => {
  const RELEASE_COLORS = ['white', 'yellow', 'blue', 'red'] as const

  // Returning the release strip's outerHTML captures the cue-bearing surface:
  // its class set, active flag, current cycle color, and fill markup. The
  // static preview light is a separate surface and is intentionally excluded
  // so this guard isolates the hold-time release cue.
  function releaseStripHtml(): string {
    return screen.getByTestId('button-release-strip').outerHTML
  }

  // The spec's hardest constraint: for any target color X, the rendered
  // emphasis must be IDENTICAL for every color, so a viewer cannot infer the
  // answer from the screen. We drive a `hold` attempt for each of the four
  // `releaseOnColor` targets into the holding state and advance every render by
  // the SAME number of cycle steps, so all four sit at the same cycle index.
  // The cue markup (strip structure + class sets) must then be byte-identical
  // across all four targets. This fails loudly if anyone later keys the
  // strip/fill on answer.releaseOnColor (the class set or structure would then
  // diverge by target).
  it('renders an identical release-strip cue for every release-on-light target', () => {
    const renderedStrips = RELEASE_COLORS.map((releaseOnColor) => {
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
      const html = releaseStripHtml()
      unmount()
      vi.useRealTimers()
      return html
    })

    // Sanity: the cue must actually be present (guards against an empty-string
    // tautology where every strip happens to be identically blank).
    expect(renderedStrips[0]).toContain('button-release-strip')
    expect(renderedStrips[0]).toContain('data-active="true"')
    expect(renderedStrips[0].length).toBeGreaterThan(0)

    // Every target's cue markup must equal white's — identical for all colors.
    for (let i = 1; i < RELEASE_COLORS.length; i++) {
      expect(
        renderedStrips[i],
        `cue markup for releaseOnColor="${RELEASE_COLORS[i]}" differs from "white" — the cue leaks the target`
      ).toBe(renderedStrips[0])
    }
    // Collapsing to a unique set must yield exactly one variant.
    expect(new Set(renderedStrips).size).toBe(1)
  })

  it('activates the release strip only while holding, while the preview light stays static', () => {
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
    const releaseStrip = () => screen.getByTestId('button-release-strip')
    const previewLight = screen.getByTestId('button-preview-light')
    const isActive = () => releaseStrip().getAttribute('data-active') === 'true'

    expect(previewLight).toHaveAttribute('data-color', 'red')

    // idle: release strip inactive.
    expect(isActive(), 'must not activate the release strip in idle state').toBe(false)
    expect(releaseStrip()).toHaveAttribute('data-color', 'inactive')

    // pressed (before the hold threshold): release strip still inactive.
    fireEvent.pointerDown(btn)
    expect(isActive(), 'must not activate the release strip in pressed state').toBe(false)
    expect(releaseStrip()).toHaveAttribute('data-color', 'inactive')

    // holding (after the hold threshold): release strip activates.
    act(() => {
      vi.advanceTimersByTime(500) // HOLD_THRESHOLD_MS -> holding
    })
    expect(isActive(), 'must activate the release strip in holding state').toBe(true)
    expect(releaseStrip()).toHaveAttribute('data-color', 'white')
    expect(previewLight).toHaveAttribute('data-color', 'red')

    vi.useRealTimers()
  })
})
