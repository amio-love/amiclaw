/**
 * ResultPage endgame-survey wiring tests.
 *
 * Covers the post-game survey integration on ResultPage:
 *   1. Any outcome on a fresh device opens the survey modal.
 *   2. A device that has already answered/skipped sees no modal.
 *   3. Submitting the survey emits `survey_submit` and marks the device.
 *   4. Skipping marks the device WITHOUT emitting `survey_submit`.
 *   5. First daily win merges the nickname gate and the survey into one modal.
 *
 * Setup mirrors the sibling ResultPage tests: pre-seed sessionStorage with a
 * finished-game state so `GameProvider`'s lazy initializer hydrates straight
 * into a renderable ResultPage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))

vi.mock('@/utils/leaderboard-api', () => ({
  submitScore: vi.fn(),
}))

// `logEvent` and the survey gating utils are hoisted mocks so each test can
// assert on them and control the once-per-device flag.
const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }))
vi.mock('@/utils/event-log', () => ({ logEvent }))

const surveyMock = vi.hoisted(() => ({
  hasAnsweredSurvey: vi.fn(),
  markSurveyAnswered: vi.fn(),
}))
vi.mock('@/utils/survey', () => surveyMock)

// No stored nickname — so a first daily win triggers the merged modal. The
// other validators are simple real-equivalent impls (the workspace jsdom
// localStorage stub is non-functional, see the sibling tests).
vi.mock('@/utils/nickname', () => ({
  NICKNAME_MAX_LENGTH: 20,
  getStoredNickname: () => null,
  isValidNickname: (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 20,
  setStoredNickname: (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 20,
}))

import ResultPage from './ResultPage'
import { GameProvider, type GameState, type GameOutcome } from '@/store/game-context'
import { submitScore } from '@/utils/leaderboard-api'

const PERSISTENCE_KEY = 'bombsquad:game-state:v2'

interface FixtureOptions {
  mode: GameState['mode']
  outcome: GameOutcome
}

function finishedState({ mode, outcome }: FixtureOptions): GameState {
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
    currentModuleIndex: sequence.length,
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
    <MemoryRouter initialEntries={['/result']}>
      <GameProvider>
        <ResultPage />
      </GameProvider>
    </MemoryRouter>
  )
}

/** Answer the three required survey questions inside an open modal. */
function answerRequiredSurvey({
  aiTool = 'Claude',
  fun = 4,
  difficulty = '刚好',
}: { aiTool?: string; fun?: number; difficulty?: string } = {}) {
  fireEvent.click(screen.getByRole('button', { name: aiTool }))
  fireEvent.click(screen.getByRole('button', { name: `好玩程度 ${fun} 分` }))
  fireEvent.click(screen.getByRole('button', { name: difficulty }))
}

describe('ResultPage endgame survey', () => {
  beforeEach(() => {
    sessionStorage.clear()
    logEvent.mockReset()
    surveyMock.hasAnsweredSurvey.mockReset()
    surveyMock.markSurveyAnswered.mockReset()
    vi.mocked(submitScore).mockReset()
    vi.mocked(submitScore).mockResolvedValue({ rank: 5, total_players: 100 })
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('opens the survey modal after any outcome on a fresh device', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
    // Survey-only modal — no nickname gate for a practice run.
    expect(screen.queryByLabelText(/昵称/)).not.toBeInTheDocument()
  })

  it('opens the survey modal even on a failed run', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'exploded' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('难度感受')).toBeInTheDocument()
  })

  it('does not open any modal once the device has answered the survey', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(true)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('submitting the survey emits survey_submit and marks the device', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    answerRequiredSurvey()
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(logEvent).toHaveBeenCalledWith('survey_submit', {
      ai_tool: 'claude',
      fun: 4,
      difficulty: 'just-right',
    })
    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    // Modal closes; the "再来一局" CTA stays reachable.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再来一局' })).toBeInTheDocument()
  })

  it('skipping the survey marks the device but never emits survey_submit', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    fireEvent.click(screen.getByRole('button', { name: '跳过' }))

    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再来一局' })).toBeInTheDocument()
  })

  it('first daily win merges the nickname gate and the survey into one modal', async () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'defused' }))

    // Exactly one dialog — never two stacked.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByLabelText(/昵称/)).toBeInTheDocument()
    expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
    // Score is gated behind the nickname while the modal is open.
    expect(submitScore).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小测' } })
    answerRequiredSurvey()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    // Nickname path fires the score submission; survey path emits telemetry.
    await waitFor(() => expect(submitScore).toHaveBeenCalledTimes(1))
    expect(vi.mocked(submitScore).mock.calls[0][0]).toMatchObject({ nickname: '小测' })
    expect(logEvent).toHaveBeenCalledWith('survey_submit', {
      ai_tool: 'claude',
      fun: 4,
      difficulty: 'just-right',
    })
    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('merged modal is confirmable with the nickname alone — survey skipped, no survey_submit', async () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'defused' }))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    // Fill only the nickname; leave the whole survey untouched.
    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小测' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    // Score still submits, the device is marked answered, but a skipped
    // survey fires no `survey_submit`.
    await waitFor(() => expect(submitScore).toHaveBeenCalledTimes(1))
    expect(vi.mocked(submitScore).mock.calls[0][0]).toMatchObject({ nickname: '小测' })
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
