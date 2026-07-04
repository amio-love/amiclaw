/**
 * ResultPage outcome-branching tests — the game-modes rework turned the
 * single success page into an outcome-aware page.
 *
 * Covers exploded (the daily 3-strike-out, the only daily failure path), the
 * two neutral cap-outs (daily-timeout / practice-timeout), and
 * practice-cleared. Setup mirrors the other ResultPage tests: pre-seed
 * sessionStorage with a finished-game state so `GameProvider`'s lazy
 * initializer hydrates straight into a renderable ResultPage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))
vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn(),
}))
vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))
// Pin the survey as already answered — these tests cover outcome branching,
// not the survey modal (see `ResultPage.survey.test.tsx` for that).
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

import ResultPage from './ResultPage'
import { GameProvider, type GameState, type GameOutcome } from '@/store/game-context'
import { submitScore } from '@shared/leaderboard-api'

const PERSISTENCE_KEY = 'bombsquad:game-state:v4'

interface FixtureOptions {
  mode: GameState['mode']
  outcome: GameOutcome
  moduleStats?: GameState['moduleStats']
  strikeCount?: number
}

function finishedState({ mode, outcome, moduleStats, strikeCount = 0 }: FixtureOptions): GameState {
  const sequence: GameState['moduleSequence'] =
    mode === 'daily' ? ['wire', 'dial', 'button', 'keypad'] : ['wire', 'keypad']
  return {
    status: 'RESULT',
    mode,
    manual: null,
    manualUrl: null,
    gameRunId: `run-${mode}-${outcome}`,
    sceneInfo: null,
    moduleSequence: sequence,
    moduleConfigs: sequence.map(() => null),
    moduleAnswers: sequence.map(() => null),
    currentModuleIndex: moduleStats?.length ?? 0,
    moduleStats: moduleStats ?? [],
    totalStartTime: 1_700_000_000_000,
    totalEndTime: 1_700_000_120_000,
    currentModuleStartTime: null,
    currentModuleErrorCount: 0,
    strikeCount,
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

describe('ResultPage outcome branches', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(submitScore).mockReset()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('exploded by 3 strikes: failure header, strike reason, no leaderboard submit', () => {
    renderResult(
      finishedState({
        mode: 'daily',
        outcome: 'exploded',
        strikeCount: 3,
        moduleStats: [{ moduleType: 'wire', timeMs: 30_000, errorCount: 1 }],
      })
    )

    expect(screen.getByRole('heading', { name: '差一点' })).toBeInTheDocument()
    // The strike-out consolation names the three-strike cause and nudges the
    // player to debrief with the AI partner.
    expect(screen.getByText(/三次失误，这一局就到这了/)).toBeInTheDocument()
    expect(screen.getByText(/跟我聊聊/)).toBeInTheDocument()
    expect(screen.queryByText(/全球排名/)).not.toBeInTheDocument()
    expect(submitScore).not.toHaveBeenCalled()
  })

  it('daily-timeout: neutral cap-out → failure variant, time-based reason, no leaderboard submit', () => {
    renderResult(
      finishedState({
        mode: 'daily',
        outcome: 'daily-timeout',
        strikeCount: 1,
        moduleStats: [{ moduleType: 'wire', timeMs: 30_000, errorCount: 0 }],
      })
    )

    // A daily cap-out is neutral — no explosion — but it never defused, so it
    // shows the gentle 差一点 failure variant with the time-based consolation
    // and submits nothing to the leaderboard.
    expect(screen.getByRole('heading', { name: '差一点' })).toBeInTheDocument()
    expect(screen.getByText(/时间走得比想象中快/)).toBeInTheDocument()
    expect(screen.getByText(/跟我复盘/)).toBeInTheDocument()
    expect(screen.queryByText(/全球排名/)).not.toBeInTheDocument()
    expect(submitScore).not.toHaveBeenCalled()
  })

  it('exploded with zero solved modules: still a failure page, not "暂无数据"', () => {
    renderResult(finishedState({ mode: 'daily', outcome: 'exploded', strikeCount: 3 }))

    expect(screen.getByRole('heading', { name: '差一点' })).toBeInTheDocument()
    expect(screen.queryByText(/暂无数据/)).not.toBeInTheDocument()
    // No breakdown table when nothing was solved.
    expect(screen.queryByText('本局回顾')).not.toBeInTheDocument()
  })

  it('practice-timeout: failure variant, names the stuck module', () => {
    renderResult(
      finishedState({
        mode: 'practice',
        outcome: 'practice-timeout',
        moduleStats: [{ moduleType: 'wire', timeMs: 30_000, errorCount: 0 }],
      })
    )

    // practice-timeout maps to the failure variant — gentle 差一点 heading,
    // the subtitle naming the module the run stopped on (keypad → 星符), and
    // the this-run review table.
    expect(screen.getByRole('heading', { name: '差一点' })).toBeInTheDocument()
    expect(screen.getByText(/卡在星符/)).toBeInTheDocument()
    expect(screen.getByText('本局回顾')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '拆弹成功' })).not.toBeInTheDocument()
  })

  it('practice-cleared: success-variant heading', () => {
    renderResult(
      finishedState({
        mode: 'practice',
        outcome: 'practice-cleared',
        moduleStats: [
          { moduleType: 'wire', timeMs: 30_000, errorCount: 0 },
          { moduleType: 'keypad', timeMs: 40_000, errorCount: 0 },
        ],
      })
    )

    expect(screen.getByRole('heading', { name: '拆弹成功' })).toBeInTheDocument()
    expect(submitScore).not.toHaveBeenCalled()
  })
})
