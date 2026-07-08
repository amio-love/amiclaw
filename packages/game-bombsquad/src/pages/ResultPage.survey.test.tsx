/**
 * ResultPage endgame-survey wiring tests.
 *
 * Covers the post-game survey integration on ResultPage:
 *   1. Any outcome on a fresh device opens the survey modal after the result
 *      feedback has had time to land.
 *   2. A device that has already answered/skipped sees no modal.
 *   3. Submitting the survey emits `survey_submit` and marks the device.
 *   4. Skipping marks the device WITHOUT emitting `survey_submit`.
 *   5. First daily win: nothing auto-opens over the celebration; the survey
 *      delay only starts once the rank outcome has settled (audit F13), so
 *      the questionnaire can never stack over the rank reveal.
 *   6. Skipping the leaderboard gate defers the survey to a later session.
 *
 * Setup mirrors the sibling ResultPage tests: pre-seed sessionStorage with a
 * finished-game state so `GameProvider`'s lazy initializer hydrates straight
 * into a renderable ResultPage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))

vi.mock('@shared/leaderboard-api', () => ({
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

vi.mock('@/utils/leaderboard-player-metadata', () => ({
  LEADERBOARD_AI_MODEL_MAX_LENGTH: 80,
  LEADERBOARD_AI_TOOL_MAX_LENGTH: 40,
  getStoredLeaderboardPlayerMetadata: () => null,
  isValidLeaderboardAiTool: (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 40,
  normalizeLeaderboardAiModel: (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed.slice(0, 80) : undefined
  },
  setStoredLeaderboardPlayerMetadata: (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    'aiTool' in value &&
    typeof (value as { aiTool?: unknown }).aiTool === 'string' &&
    (value as { aiTool: string }).aiTool.trim().length > 0,
}))

import ResultPage from './ResultPage'
import { GameProvider, type GameState, type GameOutcome } from '@/store/game-context'
import { submitScore } from '@shared/leaderboard-api'

const PERSISTENCE_KEY = 'bombsquad:game-state:v4'
const RESULT_FEEDBACK_SURVEY_DELAY_MS = 1800
// A practice win now waits a longer celebration window before the survey opens
// (audit F11). advancePastResultFeedback advances by this max, which also covers
// the shorter daily/failure delay.
const RESULT_PRACTICE_CELEBRATION_MS = 4200

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
    gameRunId: `run-${mode}-${outcome}`,
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
    <MemoryRouter initialEntries={['/bombsquad/result']}>
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

function advancePastResultFeedback() {
  act(() => {
    // Advance by the longest survey delay (the practice celebration window) so
    // this helper covers both the practice-win and the shorter daily/failure
    // timings.
    vi.advanceTimersByTime(RESULT_PRACTICE_CELEBRATION_MS)
  })
}

describe('ResultPage endgame survey', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    logEvent.mockReset()
    surveyMock.hasAnsweredSurvey.mockReset()
    surveyMock.markSurveyAnswered.mockReset()
    vi.mocked(submitScore).mockReset()
    vi.mocked(submitScore).mockResolvedValue({ ok: true, data: { rank: 5, total_players: 100 } })
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('opens the survey modal after the result feedback on a fresh device', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    expect(screen.getByText('拆弹成功')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    advancePastResultFeedback()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
    // Survey-only modal — no nickname gate for a practice run.
    expect(screen.queryByLabelText(/昵称/)).not.toBeInTheDocument()
  })

  it('practice win: the survey waits out the celebration window, not the base delay (F11)', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    expect(screen.getByText('拆弹成功')).toBeInTheDocument()
    // Past the base (daily/failure) delay the practice survey is STILL closed —
    // the win payoff is not interrupted a beat after mount.
    act(() => {
      vi.advanceTimersByTime(RESULT_FEEDBACK_SURVEY_DELAY_MS)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // It opens only once the full celebration window has elapsed.
    act(() => {
      vi.advanceTimersByTime(RESULT_PRACTICE_CELEBRATION_MS - RESULT_FEEDBACK_SURVEY_DELAY_MS)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('opens the survey modal even on a failed run', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'exploded' }))

    expect(screen.getByText('差一点')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    advancePastResultFeedback()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('难度感受')).toBeInTheDocument()
  })

  it('does not open any modal once the device has answered the survey', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(true)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    advancePastResultFeedback()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('submitting the survey emits survey_submit and marks the device', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    advancePastResultFeedback()
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

    advancePastResultFeedback()
    fireEvent.click(screen.getByRole('button', { name: '跳过' }))

    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再来一局' })).toBeInTheDocument()
  })

  it('first daily win: the survey stays deferred until the rank reveal has settled', async () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'defused' }))

    // Rank-reveal-first (audit F1): nothing auto-opens over the celebration.
    expect(screen.getByText('拆弹成功')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(submitScore).not.toHaveBeenCalled()

    // The survey delay has not even started while the run is off the board —
    // advancing past it opens nothing (audit F13).
    advancePastResultFeedback()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Open the deferred gate from the rank-card CTA and complete it. The gate
    // dialog carries no survey-only fun / difficulty questions.
    fireEvent.click(screen.getByRole('button', { name: '填写并上榜' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByLabelText(/昵称/)).toBeInTheDocument()
    expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
    expect(screen.queryByText('整体好玩程度')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小测' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    // Nickname / AI metadata path fires the score submission; survey has not
    // opened yet, so no survey telemetry or answered marker fires here.
    expect(submitScore).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitScore).mock.calls[0][0]).toMatchObject({
      nickname: '小测',
      ai_tool: 'claude',
    })
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
    expect(surveyMock.markSurveyAnswered).not.toHaveBeenCalled()

    // Flush the submit promise so the rank settles and reveals.
    await act(async () => {})
    expect(screen.getByText('全球排名')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Only now does the survey delay start; after it, the survey opens alone —
    // after the celebration beat, never over the reveal itself.
    advancePastResultFeedback()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('整体好玩程度')).toBeInTheDocument()
    answerRequiredSurvey()
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(logEvent).toHaveBeenCalledWith('survey_submit', {
      ai_tool: 'claude',
      fun: 4,
      difficulty: 'just-right',
    })
    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('daily leaderboard gate is confirmable without answering the deferred survey', async () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'defused' }))

    // Fill only the leaderboard gate; leave the survey questions for later.
    fireEvent.click(screen.getByRole('button', { name: '填写并上榜' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小测' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    // Score submits; the survey has not shown, so the device is not marked.
    expect(submitScore).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitScore).mock.calls[0][0]).toMatchObject({
      nickname: '小测',
      ai_tool: 'claude',
    })
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
    expect(surveyMock.markSurveyAnswered).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Rank settles, then the deferred survey opens and is skippable.
    await act(async () => {})
    advancePastResultFeedback()

    fireEvent.click(screen.getByRole('button', { name: '跳过' }))
    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
  })

  it('skipping the leaderboard gate defers the survey to a later session', async () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'defused' }))

    fireEvent.click(screen.getByRole('button', { name: '填写并上榜' }))
    fireEvent.click(screen.getByRole('button', { name: '稍后再说' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The run never settled on the board this session — the survey never
    // opens and the device is NOT marked answered, so a later session can
    // still ask once.
    advancePastResultFeedback()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(surveyMock.markSurveyAnswered).not.toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
  })
})
