/**
 * GamePage stopwatch integration test.
 *
 * Verifies the timer counts UP from 00:00 (a stopwatch — the elapsed time is
 * the score), never detonates at the old daily countdown boundary, and ends
 * the run neutrally only when the 1-hour hard cap is reached. Setup mirrors
 * the ResultPage tests: pre-seed sessionStorage with a live PLAYING state so
 * `GameProvider`'s lazy initializer hydrates straight into a running game, then
 * drive wall-clock time with fake timers and assert the rendered elapsed time.
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
import { GameProvider, type GameState, TIME_BUDGET_MS } from '@/store/game-context'

const PERSISTENCE_KEY = 'bombsquad:game-state:v3'
const T0 = 1_700_000_000_000

// The old daily countdown ended at 10 minutes. The stopwatch must sail past
// this boundary without ending the run — time is now a score, not a deadline.
const OLD_DAILY_COUNTDOWN_MS = 600_000

function playingState(mode: GameState['mode'], overrides: Partial<GameState> = {}): GameState {
  const sequence: GameState['moduleSequence'] =
    mode === 'daily' ? ['wire', 'dial', 'button', 'keypad'] : ['wire', 'keypad']
  return {
    status: 'PLAYING',
    mode,
    manual: {} as GameState['manual'],
    manualUrl: `https://claw.amio.fans/manual/${mode}`,
    sceneInfo: { sceneTongueTwister: '四是四十是十', batteryCount: 2, indicators: [] },
    moduleSequence: sequence,
    moduleConfigs: sequence.map(() => ({})) as GameState['moduleConfigs'],
    moduleAnswers: sequence.map(() => ({})) as GameState['moduleAnswers'],
    currentModuleIndex: 0,
    moduleStats: [],
    totalStartTime: T0,
    totalEndTime: null,
    currentModuleStartTime: T0,
    currentModuleErrorCount: 0,
    strikeCount: 0,
    timeBudgetMs: TIME_BUDGET_MS[mode], // 1-hour hard cap
    outcome: null,
    errorMessage: null,
    errorKind: null,
    attemptNumber: 1,
    rngSeed: 42,
    ...overrides,
  }
}

function seedAndRender(mode: GameState['mode'], overrides: Partial<GameState> = {}) {
  sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(playingState(mode, overrides)))
  return render(
    <MemoryRouter initialEntries={[`/bombsquad/run?mode=${mode}`]}>
      <GameProvider>
        <GamePage />
      </GameProvider>
    </MemoryRouter>
  )
}

describe('GamePage stopwatch', () => {
  beforeEach(() => {
    sessionStorage.clear()
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

  it('counts UP from 00:00 (elapsed time is the score)', async () => {
    seedAndRender('practice')

    // At t=0 a count-up stopwatch shows 00:00 — not the per-mode budget a
    // countdown would have shown.
    expect(screen.getByRole('timer').textContent).toBe('00:00')

    // Advance the wall clock continuously so useTimer's rAF loop ticks. 1600ms
    // is exactly 100 animation frames (16ms each); the timer steps UP to 00:01.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(screen.getByRole('timer').textContent).toBe('00:01')

    // Another 1600ms — increasing monotonically away from zero.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(screen.getByRole('timer').textContent).toBe('00:03')
  }, 15000)

  it('daily run sails past the old 10-minute countdown boundary without ending', async () => {
    seedAndRender('daily')

    // Advance just past the old daily countdown deadline. A countdown would
    // have detonated here; the stopwatch keeps running.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OLD_DAILY_COUNTDOWN_MS + 1000)
    })

    // The run is still PLAYING — the timer is on-screen and has counted UP to
    // at least the 10-minute mark (the rAF loop lands within a frame of the
    // target, so assert minutes ≥ 10 rather than an exact second), and no
    // explosion overlay has fired (the explosion overlay renders
    // role="alert" / "BOOM").
    const timer = screen.getByRole('timer')
    const [minutes] = (timer.textContent ?? '00:00').split(':').map(Number)
    expect(minutes).toBeGreaterThanOrEqual(10)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('BOOM')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-wire')).toBeInTheDocument()
  }, 15000)

  it('ends the run neutrally (no explosion) when the hard cap is reached', async () => {
    // Use a small cap so the run can be driven to it cheaply; the cap field is
    // the only thing the cap-detection effect compares elapsed against.
    const CAP = 8_000
    seedAndRender('daily', { timeBudgetMs: CAP })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAP + 1000)
    })

    // Reaching the cap fires TIME_EXPIRED → daily-timeout → RESULT, which
    // navigates away from the game page. Crucially it never shows the
    // explosion overlay (role="alert" / "BOOM"): time is not a detonator.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('BOOM')).not.toBeInTheDocument()
  }, 15000)
})
