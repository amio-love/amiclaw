/**
 * ResultPage success-payoff tests — the success screen plays a short rising
 * sting on entry, the audible half of the success-only celebration. Failure
 * stays silent (the detonation already played during EXPLODING).
 *
 * Setup mirrors ResultPage.outcome.test.tsx: pre-seed sessionStorage with a
 * finished-game state so GameProvider hydrates straight into a renderable page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))
vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn(),
}))
vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))
vi.mock('@/utils/survey', () => ({
  hasAnsweredSurvey: () => true,
  markSurveyAnswered: vi.fn(),
}))
vi.mock('@/utils/nickname', () => ({
  NICKNAME_MAX_LENGTH: 20,
  getStoredNickname: () => '测试玩家',
  isValidNickname: () => true,
  setStoredNickname: () => true,
}))
vi.mock('@/audio/useSfx', () => ({ playSfx: vi.fn() }))

import ResultPage from './ResultPage'
import { GameProvider, type GameState, type GameOutcome } from '@/store/game-context'
import { playSfx } from '@/audio/useSfx'

const PERSISTENCE_KEY = 'bombsquad:game-state:v3'

function finishedState(mode: GameState['mode'], outcome: GameOutcome): GameState {
  const sequence: GameState['moduleSequence'] =
    mode === 'daily' ? ['wire', 'dial', 'button', 'keypad'] : ['wire', 'keypad']
  return {
    status: 'RESULT',
    mode,
    manual: null,
    manualUrl: null,
    sceneInfo: null,
    moduleSequence: sequence,
    moduleConfigs: sequence.map(() => null),
    moduleAnswers: sequence.map(() => null),
    currentModuleIndex: 2,
    moduleStats: [
      { moduleType: 'wire', timeMs: 30_000, errorCount: 0 },
      { moduleType: 'keypad', timeMs: 40_000, errorCount: 0 },
    ],
    totalStartTime: 1_700_000_000_000,
    totalEndTime: 1_700_000_120_000,
    currentModuleStartTime: null,
    currentModuleErrorCount: 0,
    strikeCount: 0,
    timeBudgetMs: mode === 'daily' ? 600_000 : 300_000,
    outcome,
    errorMessage: null,
    errorKind: null,
    attemptNumber: 1,
    rngSeed: 42,
  }
}

function renderResult(state: GameState) {
  sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(state))
  return render(
    <MemoryRouter initialEntries={['/bombsquad/result']}>
      <GameProvider>
        <ResultPage />
      </GameProvider>
    </MemoryRouter>
  )
}

describe('ResultPage success payoff', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(playSfx).mockReset()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('plays the success sting on a cleared run', () => {
    renderResult(finishedState('practice', 'practice-cleared'))
    expect(playSfx).toHaveBeenCalledWith('result-success')
    expect(playSfx).toHaveBeenCalledTimes(1)
  })

  it('stays silent on a failed run', () => {
    renderResult(finishedState('practice', 'practice-timeout'))
    expect(playSfx).not.toHaveBeenCalled()
  })
})
