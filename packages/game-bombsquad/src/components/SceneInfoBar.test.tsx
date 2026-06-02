import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { SceneInfo } from '@shared/manual-schema'
import SceneInfoBar from './SceneInfoBar'

const sceneWithIndicators: SceneInfo = {
  sceneTongueTwister: '四是四十是十',
  batteryCount: 2,
  indicators: [
    { label: 'CLR', lit: true },
    { label: 'SND', lit: false },
    { label: 'FRK', lit: true },
  ],
}

describe('SceneInfoBar', () => {
  it('renders the battery count under its own 电池 label', () => {
    render(<SceneInfoBar sceneInfo={sceneWithIndicators} />)
    expect(screen.getByText('电池：')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders indicators under a dedicated 指示灯 label, separate from the battery field', () => {
    render(<SceneInfoBar sceneInfo={sceneWithIndicators} />)

    const indicatorField = screen.getByText('指示灯：').parentElement as HTMLElement
    const batteryField = screen.getByText('电池：').parentElement as HTMLElement

    // The indicator chips live inside their own labelled group, a different
    // element from the 电池 field — so the chips can no longer be misread as
    // part of the battery count (the original "shows 2, see 3 symbols" bug).
    expect(indicatorField).not.toBe(batteryField)
    for (const label of ['CLR', 'SND', 'FRK']) {
      const chip = screen.getByText(label)
      expect(indicatorField).toContainElement(chip)
      expect(batteryField).not.toContainElement(chip)
    }
  })

  it('shows 无 under the 指示灯 label when a scene has no indicators', () => {
    render(
      <SceneInfoBar
        sceneInfo={{ sceneTongueTwister: '四是四十是十', batteryCount: 1, indicators: [] }}
      />
    )
    expect(screen.getByText('指示灯：')).toBeInTheDocument()
    expect(screen.getByText('无')).toBeInTheDocument()
  })
})

describe('SceneInfoBar first-run nudge', () => {
  it('does not render the nudge by default', () => {
    render(<SceneInfoBar sceneInfo={sceneWithIndicators} />)
    expect(screen.queryByText(/读给 AI/)).not.toBeInTheDocument()
  })

  it('renders the dismissible hint when showNudge is set', () => {
    render(<SceneInfoBar sceneInfo={sceneWithIndicators} showNudge />)
    expect(screen.getByText(/读给 AI/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭提示' })).toBeInTheDocument()
    // The scene fields stay rendered alongside the hint.
    expect(screen.getByText('暗号：')).toBeInTheDocument()
  })

  it('calls onDismissNudge when the hint is dismissed', () => {
    const onDismissNudge = vi.fn()
    render(
      <SceneInfoBar sceneInfo={sceneWithIndicators} showNudge onDismissNudge={onDismissNudge} />
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(onDismissNudge).toHaveBeenCalledTimes(1)
  })
})
