/**
 * @vitest-environment jsdom
 *
 * useGameSession answer-guard contract, tested at the hook level (independent
 * of the UI). Runs in jsdom because the hook uses React state + performance.now.
 * The level is assembled from the same on-disk fixture the dev shell reads, so
 * the guards run against the REAL engine — no engine mock.
 */

import { act, renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGameType, loadLevel } from '@amiclaw/creation'
import type { PlayableLevel } from '../content/levels'
import { TUTORIAL_SEGMENTS } from '../content/tutorial-level'
import { useGameSession } from './useGameSession'

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'creation',
  'fixtures'
)
const gameType = loadGameType(
  readFileSync(join(fixtures, 'radio-cipher', 'game-type.yaml'), 'utf8')
)
const level = loadLevel(
  readFileSync(join(fixtures, 'radio-cipher', 'level.rc-demo-001.yaml'), 'utf8')
)

const tutorialLevel: PlayableLevel = {
  key: '1',
  title: '新手训练电台',
  tab: '',
  tagline: '',
  gameType,
  level,
  segments: TUTORIAL_SEGMENTS,
}

describe('useGameSession answer guards', () => {
  it('rejects an empty / whitespace answer with no penalty', () => {
    const { result } = renderHook(() => useGameSession(tutorialLevel))
    let outcome!: ReturnType<typeof result.current.submitAnswer>
    act(() => {
      outcome = result.current.submitAnswer('seg-1', '   ')
    })
    expect(outcome).toEqual({ ok: false, reason: 'empty' })
    expect(result.current.penaltySeconds).toBe(0)
    expect(result.current.wrongToken).toBe(0)
    expect(result.current.segments.find((s) => s.id === 'seg-1')?.decrypted).toBe(false)
  })

  it('charges +30s and flags a wrong answer', () => {
    const { result } = renderHook(() => useGameSession(tutorialLevel))
    let outcome!: ReturnType<typeof result.current.submitAnswer>
    act(() => {
      outcome = result.current.submitAnswer('seg-1', '错误')
    })
    expect(outcome).toEqual({ ok: false, reason: 'wrong' })
    expect(result.current.penaltySeconds).toBe(30)
    expect(result.current.wrongToken).toBe(1)
  })

  it('accepts the correct answer and drives the engine to decrypted', () => {
    const { result } = renderHook(() => useGameSession(tutorialLevel))
    let outcome!: ReturnType<typeof result.current.submitAnswer>
    act(() => {
      outcome = result.current.submitAnswer('seg-1', '猴子')
    })
    expect(outcome).toEqual({ ok: true })
    expect(result.current.segments.find((s) => s.id === 'seg-1')?.decrypted).toBe(true)
    expect(result.current.penaltySeconds).toBe(0)
  })
})

describe('useGameSession stopwatch start gating', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('accrues no time until start() fires (onboarding reading is not scored)', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { result } = renderHook(() => useGameSession(tutorialLevel))

    // Interval ticks while the clock is gated off — elapsed stays 0.
    nowSpy.mockReturnValue(9000)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.elapsedSeconds).toBe(0)
    expect(result.current.totalSeconds).toBe(0)

    // start() anchors at the current now; subsequent ticks accrue from there.
    nowSpy.mockReturnValue(10000)
    act(() => {
      result.current.start()
    })
    nowSpy.mockReturnValue(12000)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.elapsedSeconds).toBeCloseTo(2)
  })

  it('is idempotent: a second start() does not re-anchor the clock', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { result } = renderHook(() => useGameSession(tutorialLevel))
    act(() => {
      result.current.start()
    })
    // A later start() (e.g. re-opening 「怎么玩？」 then closing) must be ignored.
    nowSpy.mockReturnValue(5000)
    act(() => {
      result.current.start()
    })
    nowSpy.mockReturnValue(6000)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.elapsedSeconds).toBeCloseTo(5)
  })

  it('re-anchors and keeps running on reset (replay is the interaction)', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { result } = renderHook(() => useGameSession(tutorialLevel))
    act(() => {
      result.current.start()
    })
    nowSpy.mockReturnValue(5000)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.elapsedSeconds).toBeCloseTo(4)

    nowSpy.mockReturnValue(5000)
    act(() => {
      result.current.reset()
    })
    nowSpy.mockReturnValue(6000)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.elapsedSeconds).toBeCloseTo(1)
    expect(result.current.penaltySeconds).toBe(0)
  })
})
