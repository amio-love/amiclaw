/**
 * GamePage countdown-timer integration test.
 *
 * Verifies the timer counts DOWN from the per-mode budget toward zero (not up
 * from zero like the old stopwatch). Setup mirrors the ResultPage tests:
 * pre-seed sessionStorage with a live PLAYING state so `GameProvider`'s lazy
 * initializer hydrates straight into a running game, then drive wall-clock
 * time with fake timers and assert the rendered remaining time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))

// Real modules expect real puzzle configs; stub the two practice modules so
// the seeded `{}` configs render harmlessly.
vi.mock('@/modules/wire/WireModule', () => ({
  default: () => <div data-testid="mock-wire" />,
}))
vi.mock('@/modules/keypad/KeypadModule', () => ({
  default: () => <div data-testid="mock-keypad" />,
}))

import GamePage from './GamePage'
import { GameProvider, type GameState } from '@/store/game-context'

const PERSISTENCE_KEY = 'bombsquad:game-state:v2'
const T0 = 1_700_000_000_000

function playingPracticeState(): GameState {
  return {
    status: 'PLAYING',
    mode: 'practice',
    manual: {} as GameState['manual'],
    manualUrl: 'https://bombsquad.amio.fans/manual/practice',
    sceneInfo: { sceneTongueTwister: '四是四十是十', batteryCount: 2, indicators: [] },
    moduleSequence: ['wire', 'keypad'],
    moduleConfigs: [{}, {}] as GameState['moduleConfigs'],
    moduleAnswers: [{}, {}] as GameState['moduleAnswers'],
    currentModuleIndex: 0,
    moduleStats: [],
    totalStartTime: T0,
    totalEndTime: null,
    currentModuleStartTime: T0,
    currentModuleErrorCount: 0,
    strikeCount: 0,
    timeBudgetMs: 300_000, // 5 minutes
    outcome: null,
    errorMessage: null,
    errorKind: null,
    attemptNumber: 1,
    rngSeed: 42,
  }
}

describe('GamePage countdown timer', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(playingPracticeState()))
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('counts down from the time budget toward zero', async () => {
    render(
      <MemoryRouter initialEntries={['/game/run?mode=practice']}>
        <GameProvider>
          <GamePage />
        </GameProvider>
      </MemoryRouter>
    )

    // At t=0 the timer shows the full 5-minute budget — not 00:00, which is
    // what a count-up stopwatch would show at the start.
    expect(screen.getByRole('timer').textContent).toBe('05:00')

    // Advance the wall clock continuously so useTimer's rAF loop ticks. 1600ms
    // is exactly 100 animation frames (16ms each); the timer steps DOWN to
    // 04:58 (a count-up stopwatch would instead show 00:01 here).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(screen.getByRole('timer').textContent).toBe('04:58')

    // Another 1600ms — still decreasing monotonically toward zero.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(screen.getByRole('timer').textContent).toBe('04:56')
  }, 15000)
})
