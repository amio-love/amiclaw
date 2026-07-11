/**
 * ResultPage endgame-survey wiring tests (audit U13 — fold-in entry).
 *
 * The survey is no longer an auto-opening modal. After the settlement has
 * settled, a calm 「聊聊这一局」entry folds in at the very bottom; tapping it
 * opens the survey modal. It can never stack over the celebration, the
 * consolation, or a server-rejection notice. Covered:
 *   1. Any fresh-device outcome grows the fold-in entry after the settle delay.
 *   2. A device that already answered/skipped sees no entry.
 *   3. Submitting emits `survey_submit` and marks the device.
 *   4. Skipping marks the device WITHOUT emitting `survey_submit`.
 *   5. A daily win defers the entry until the run's identity/rank has settled.
 *   6. A server-rejection notice suppresses the entry (the player must read it).
 *
 * Setup mirrors the sibling ResultPage tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))

vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn(),
  fetchLeaderboard: vi.fn(),
}))

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }))
vi.mock('@/utils/event-log', () => ({ logEvent }))

const surveyMock = vi.hoisted(() => ({
  hasAnsweredSurvey: vi.fn(),
  markSurveyAnswered: vi.fn(),
}))
vi.mock('@/utils/survey', () => surveyMock)

const { fetchArcadeProfile } = vi.hoisted(() => ({ fetchArcadeProfile: vi.fn() }))
vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: vi.fn().mockResolvedValue({ kind: 'anon' }),
  fetchArcadeProfile,
}))

import ResultPage from './ResultPage'
import { GameProvider, type GameState, type GameOutcome } from '@/store/game-context'
import { submitScore } from '@shared/leaderboard-api'

const PERSISTENCE_KEY = 'bombsquad:game-state:v4'
const RESULT_FEEDBACK_SURVEY_DELAY_MS = 1800
// A practice win waits a longer celebration window before the entry folds in
// (audit F11). advancePastResultFeedback advances by this max, which also covers
// the shorter daily/failure delay.
const RESULT_PRACTICE_CELEBRATION_MS = 4200

function installFakeLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  })
  return store
}

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
    vi.advanceTimersByTime(RESULT_PRACTICE_CELEBRATION_MS)
  })
}

/** Open the folded-in survey entry into the modal. */
function openSurveyEntry() {
  fireEvent.click(screen.getByRole('button', { name: /聊聊这一局/ }))
}

describe('ResultPage endgame survey (fold-in entry)', () => {
  beforeEach(() => {
    installFakeLocalStorage()
    vi.useFakeTimers()
    sessionStorage.clear()
    logEvent.mockReset()
    surveyMock.hasAnsweredSurvey.mockReset()
    surveyMock.markSurveyAnswered.mockReset()
    fetchArcadeProfile.mockReset()
    fetchArcadeProfile.mockResolvedValue({ kind: 'anon' })
    vi.mocked(submitScore).mockReset()
    vi.mocked(submitScore).mockResolvedValue({ ok: true, data: { rank: 5, total_players: 100 } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('grows a fold-in entry after the settle delay, opening the survey modal on tap', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    // Celebration is unobstructed — no modal, and the entry has not folded in yet.
    expect(screen.getByText('拆弹成功')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /聊聊这一局/ })).not.toBeInTheDocument()

    advancePastResultFeedback()

    // The calm entry folds in; tapping it — and only then — opens the modal.
    expect(screen.getByRole('button', { name: /聊聊这一局/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    openSurveyEntry()
    expect(screen.getByRole('dialog', { name: '聊聊这一局' })).toBeInTheDocument()
    expect(screen.getByText('你这局用的是哪个 AI 工具？')).toBeInTheDocument()
  })

  it('practice win: the entry waits out the full celebration window, not the base delay (F11)', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    // Past the base (daily/failure) delay the entry is STILL absent.
    act(() => {
      vi.advanceTimersByTime(RESULT_FEEDBACK_SURVEY_DELAY_MS)
    })
    expect(screen.queryByRole('button', { name: /聊聊这一局/ })).not.toBeInTheDocument()

    // It folds in only once the full celebration window has elapsed.
    act(() => {
      vi.advanceTimersByTime(RESULT_PRACTICE_CELEBRATION_MS - RESULT_FEEDBACK_SURVEY_DELAY_MS)
    })
    expect(screen.getByRole('button', { name: /聊聊这一局/ })).toBeInTheDocument()
  })

  it('folds the entry in even on a failed run, never over the consolation', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'daily', outcome: 'exploded' }))

    expect(screen.getByText('差一点')).toBeInTheDocument()
    // The consolation quote owns the moment; no modal auto-opens over it.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    advancePastResultFeedback()
    expect(screen.getByRole('button', { name: /聊聊这一局/ })).toBeInTheDocument()

    openSurveyEntry()
    expect(screen.getByText('难度感受')).toBeInTheDocument()
  })

  it('does not fold in any entry once the device has answered the survey', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(true)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    advancePastResultFeedback()

    expect(screen.queryByRole('button', { name: /聊聊这一局/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('submitting the survey emits survey_submit and marks the device', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    advancePastResultFeedback()
    openSurveyEntry()
    answerRequiredSurvey()
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(logEvent).toHaveBeenCalledWith('survey_submit', {
      ai_tool: 'claude',
      fun: 4,
      difficulty: 'just-right',
    })
    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    // Modal closes; the entry retires; the "再来一局" CTA stays reachable.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /聊聊这一局/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再来一局' })).toBeInTheDocument()
  })

  it('skipping the survey marks the device but never emits survey_submit', () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    renderResult(finishedState({ mode: 'practice', outcome: 'practice-cleared' }))

    advancePastResultFeedback()
    openSurveyEntry()
    fireEvent.click(screen.getByRole('button', { name: '跳过' }))

    expect(surveyMock.markSurveyAnswered).toHaveBeenCalledTimes(1)
    expect(logEvent).not.toHaveBeenCalledWith('survey_submit', expect.anything())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再来一局' })).toBeInTheDocument()
  })

  it('first daily win: the entry stays deferred until the run has settled', async () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    // Anonymous → the run resolves to the login-invite state, which counts as
    // settled; before that resolves, the settle delay must not even start.
    fetchArcadeProfile.mockResolvedValue({ kind: 'anon' })
    renderResult(finishedState({ mode: 'daily', outcome: 'defused' }))

    // While identity is still resolving, advancing the clock folds in nothing.
    advancePastResultFeedback()
    expect(screen.queryByRole('button', { name: /聊聊这一局/ })).not.toBeInTheDocument()

    // Resolve identity → the run settles → only now does the delay begin.
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /聊聊这一局/ })).not.toBeInTheDocument()

    advancePastResultFeedback()
    expect(screen.getByRole('button', { name: /聊聊这一局/ })).toBeInTheDocument()
  })

  it('suppresses the entry while a server-rejection notice is showing (F8)', async () => {
    surveyMock.hasAnsweredSurvey.mockReturnValue(false)
    localStorage.setItem('bombsquad-leaderboard-ai-tool', 'claude')
    fetchArcadeProfile.mockResolvedValue({
      kind: 'ok',
      profile: undefined,
      publicProfile: { claimed: true, public_label: '公开名' },
    })
    vi.mocked(submitScore).mockResolvedValue({
      ok: false,
      kind: 'rejected',
      status: 422,
      error: 'Time too short — minimum 60 seconds',
    })
    renderResult(finishedState({ mode: 'daily', outcome: 'defused' }))

    // Flush identity resolve + auto-submit → the inline rejection notice renders
    // (its 重试 button is the reliable marker of the rejected state).
    await act(async () => {})
    await act(async () => {})
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()

    // The settle delay elapses, but the entry must NOT fold in over the rejection
    // notice — the player has to read why nothing landed.
    advancePastResultFeedback()
    expect(screen.queryByRole('button', { name: /聊聊这一局/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
