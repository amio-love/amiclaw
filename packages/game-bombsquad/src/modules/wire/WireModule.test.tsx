import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import WireModule, { STRAND_CASING } from './WireModule'
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

// Full 6-color vocabulary, including the previously near-invisible `black`.
const allColorsConfig = {
  wires: [
    { color: 'red' as const },
    { color: 'blue' as const },
    { color: 'yellow' as const },
    { color: 'green' as const },
    { color: 'white' as const },
    { color: 'black' as const },
  ],
}
const allColorsAnswer = { type: 'wire' as const, cutPosition: 0 }

// --- WCAG contrast helpers (used by the casing contrast-floor guard) ---
function srgbToLinear(channel: number): number {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}
function compositeOver(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number]
): [number, number, number] {
  return [
    Math.round(alpha * fg[0] + (1 - alpha) * bg[0]),
    Math.round(alpha * fg[1] + (1 - alpha) * bg[1]),
    Math.round(alpha * fg[2] + (1 - alpha) * bg[2]),
  ]
}
function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}
function parseRgba(value: string): { rgb: [number, number, number]; alpha: number } {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match) throw new Error(`unparseable color: ${value}`)
  const parts = match[1].split(',').map((p) => parseFloat(p.trim()))
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 }
}

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

  // Regression guard for the dark-wire visibility fix (playtest finding F10).
  // Before the fix there was no casing element at all, so this FAILS pre-fix.
  it('draws a wider neutral casing UNDER every idle strand, including the dark wire', () => {
    render(
      <WireModule
        config={allColorsConfig}
        answer={allColorsAnswer}
        onComplete={vi.fn()}
        onError={vi.fn()}
        sceneInfo={sceneInfo}
      />
    )
    for (let i = 0; i < allColorsConfig.wires.length; i++) {
      const strand = screen.getByTestId(`strand-${i}`)
      const casing = screen.getByTestId(`strand-casing-${i}`)
      expect(casing).toBeInTheDocument()
      // The casing must be wider than the colored strand so it shows as an edge.
      const casingWidth = Number(casing.getAttribute('stroke-width'))
      const strandWidth = Number(strand.getAttribute('stroke-width'))
      expect(casingWidth).toBeGreaterThan(strandWidth)
      // The casing must paint UNDER the strand — i.e. appear earlier in the DOM
      // so the colored strand renders on top of it.
      expect(casing.compareDocumentPosition(strand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('casing color clears the WCAG 3:1 graphical-object floor over the dark stage', () => {
    // Effective stage background: the stage paints rgba(5,5,17,0.5) over the
    // page's #050511 bottom gradient stop, which composites back to ≈ #050511.
    const stageBg: [number, number, number] = [5, 5, 17]
    const { rgb, alpha } = parseRgba(STRAND_CASING)
    const cased = compositeOver(rgb, alpha, stageBg)
    const ratio = contrastRatio(relativeLuminance(cased), relativeLuminance(stageBg))
    expect(ratio).toBeGreaterThanOrEqual(3)

    // Sanity: the bare `black` strand value (#333344) is what fails this floor,
    // which is exactly why the casing is needed.
    const bareBlackRatio = contrastRatio(
      relativeLuminance([0x33, 0x33, 0x44]),
      relativeLuminance(stageBg)
    )
    expect(bareBlackRatio).toBeLessThan(3)
  })
})
