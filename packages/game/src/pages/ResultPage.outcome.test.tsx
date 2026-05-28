/**
 * ResultPage outcome-branching tests — the game-modes rework turned the
 * single success page into a four-way outcome-aware page.
 *
 * Covers exploded (3-strike and timeout), practice-cleared and
 * practice-timeout. Setup mirrors the other ResultPage tests: pre-seed
 * sessionStorage with a finished-game state so `GameProvider`'s lazy
 * initializer hydrates straight into a renderable ResultPage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))
vi.mock('@/utils/leaderboard-api', () => ({
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
import { submitScore } from '@/utils/leaderboard-api'
import * as clipboardModule from '@/utils/clipboard'

const PERSISTENCE_KEY = 'bombsquad:game-state:v2'

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
    expect(screen.getByText(/三次失误就到这了/)).toBeInTheDocument()
    expect(screen.queryByText(/全球排名/)).not.toBeInTheDocument()
    expect(submitScore).not.toHaveBeenCalled()
  })

  it('exploded by timeout: failure reason names time, not strikes', () => {
    renderResult(
      finishedState({
        mode: 'daily',
        outcome: 'exploded',
        strikeCount: 1,
        moduleStats: [{ moduleType: 'wire', timeMs: 30_000, errorCount: 0 }],
      })
    )

    expect(screen.getByRole('heading', { name: '差一点' })).toBeInTheDocument()
    expect(screen.getByText(/时间走得比想象中快/)).toBeInTheDocument()
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

  it('copyable recap summary reflects the failure outcome', async () => {
    const copySpy = vi.spyOn(clipboardModule, 'copyToClipboard').mockResolvedValue(true)
    renderResult(
      finishedState({
        mode: 'daily',
        outcome: 'exploded',
        strikeCount: 3,
        moduleStats: [{ moduleType: 'wire', timeMs: 30_000, errorCount: 1 }],
      })
    )

    fireEvent.click(screen.getByRole('button', { name: '复制赛后摘要' }))

    expect(copySpy).toHaveBeenCalledTimes(1)
    const summary = copySpy.mock.calls[0][0] as string
    expect(summary).toContain('结果：失败 💥')
    expect(summary).toContain('1. 光弦模块')
    expect(summary).toContain('1 次失误')
    copySpy.mockRestore()
  })
})
