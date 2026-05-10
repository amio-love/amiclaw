/**
 * ResultPage replay_intent event-log test.
 *
 * Asserts that clicking "再来一局" emits a single `[bombsquad-event]`
 * console.info line whose payload satisfies
 * `{ event: 'replay_intent', mode, attemptNumber }`. This is the data point
 * roadmap §Strategic Objectives Validation Criteria #3 (复玩意愿 ≥50%) is
 * estimated from during the manual-metrics window.
 *
 * Setup approach: pre-seed sessionStorage with a finished-game (RESULT) state
 * so `GameProvider`'s lazy initializer hydrates straight into a renderable
 * ResultPage, instead of driving the 4-module flow end-to-end (which is
 * already covered by `game-flow.test.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ResultPage from './ResultPage'
import { GameProvider, type GameState } from '@/store/game-context'
import { EVENT_LOG_PREFIX } from '@/utils/event-log'

const PERSISTENCE_KEY = 'bombsquad:game-state:v1'

function finishedPracticeState(): GameState {
  // Seed `attemptNumber` to a non-default value (7), distinct from
  // INITIAL_STATE.attemptNumber (=1). This protects against any refactor that
  // accidentally reads the post-RESET state when emitting `replay_intent` —
  // e.g. a future change that re-reads from a freshly-dispatched store
  // snapshot (selector hook, ref, or restructured imperative read) instead of
  // the closure's pre-RESET `state` — which would surface as `attemptNumber: 1`
  // in the captured payload and fail the assertion below loud. Note: the
  // current implementation captures `state.attemptNumber` from the React
  // closure, so a literal swap of `logEvent` and `dispatch({type:'RESET'})`
  // call lines alone would NOT change the captured value (the closure is
  // pinned at render time); the seed defends the broader call-order intent.
  return {
    status: 'RESULT',
    mode: 'practice',
    manual: null,
    manualUrl: null,
    sceneInfo: null,
    moduleConfigs: [null, null, null, null],
    moduleAnswers: [null, null, null, null],
    currentModuleIndex: 4,
    moduleStats: [
      { moduleType: 'wire', timeMs: 30_000, errorCount: 0 },
      { moduleType: 'dial', timeMs: 45_000, errorCount: 1 },
      { moduleType: 'button', timeMs: 25_000, errorCount: 0 },
      { moduleType: 'keypad', timeMs: 50_000, errorCount: 0 },
    ],
    totalStartTime: 1_700_000_000_000,
    totalEndTime: 1_700_000_150_000,
    currentModuleStartTime: null,
    currentModuleErrorCount: 0,
    errorMessage: null,
    errorKind: null,
    attemptNumber: 7,
    rngSeed: 12345,
  }
}

describe('ResultPage replay_intent logging', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedPracticeState()))
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
    sessionStorage.clear()
  })

  it('emits replay_intent with mode and attemptNumber when "再来一局" is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/result']}>
        <GameProvider>
          <ResultPage />
        </GameProvider>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: '再来一局' }))

    // Filter to replay_intent calls — defensive against any future event that
    // might be emitted on the same path. The contract is "exactly one
    // replay_intent per click", not "no other events".
    const replayCalls = infoSpy.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === EVENT_LOG_PREFIX &&
        (c[1] as { event?: string } | undefined)?.event === 'replay_intent'
    )
    expect(replayCalls).toHaveLength(1)

    const payload = replayCalls[0][1] as Record<string, unknown>
    expect(payload).toMatchObject({
      event: 'replay_intent',
      mode: 'practice',
      attemptNumber: 7,
    })
    expect(typeof payload.timestamp).toBe('string')
    expect(payload.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })
})
