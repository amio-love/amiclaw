/**
 * ResultPage nickname-gate integration tests.
 *
 * Covers the branches of the daily-mode submission flow:
 *   1. First-visit daily run, localStorage empty → the celebration renders
 *      FIRST with no auto-opened modal (rank-reveal-first ordering, audit F1);
 *      the rank card states the honest not-on-board fact and its CTA opens the
 *      deferrable gate; submission only fires after the player confirms.
 *   2. Skip path → deferring the gate keeps the run off the board, with the
 *      CTA still offered for a later fill.
 *   3. Deferred-fill path → reopening the gate after a skip still submits and
 *      reveals the rank.
 *   4. Returning daily run, localStorage already has nickname + AI metadata
 *      → no modal, the score is submitted immediately with cached values.
 *   5. Practice mode → no modal, no submit (practice never posts a score).
 *
 * Setup mirrors `ResultPage.test.tsx`: pre-seed sessionStorage with a finished
 * game state so `GameProvider`'s lazy initializer hydrates straight into a
 * renderable ResultPage instead of driving the 4-module flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { STUB_DEVICE_ID } = vi.hoisted(() => ({
  STUB_DEVICE_ID: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => STUB_DEVICE_ID,
}))

vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn(),
  fetchLeaderboard: vi.fn(),
}))

// Event-log POSTs to /api/events on RESET / mount-side effects — mock it away
// so we don't need a global fetch stub and the tests stay focused on submit.
vi.mock('@/utils/event-log', () => ({
  logEvent: vi.fn(),
}))

// The post-game modal now also carries a once-per-device survey section.
// These tests exercise only the nickname gate, so pin the survey as already
// answered — otherwise the survey section would render alongside the nickname
// section and the confirm button would gate on the survey too. The merged
// nickname+survey path has its own coverage in `ResultPage.survey.test.tsx`.
vi.mock('@/utils/survey', () => ({
  hasAnsweredSurvey: () => true,
  markSurveyAnswered: vi.fn(),
}))

import ResultPage from './ResultPage'
import { submitScore } from '@shared/leaderboard-api'
import { submitArcadeProfileEvent } from '@amiclaw/arcade-profile/api-client'
import type { ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import { ARCADE_LOCAL_PROFILE_KEY, readArcadeLocalProfile } from '@amiclaw/arcade-profile/local'
import { GameProvider, type GameState } from '@/store/game-context'

const PERSISTENCE_KEY = 'bombsquad:game-state:v4'
const NICKNAME_KEY = 'bombsquad-nickname'
const AI_TOOL_KEY = 'bombsquad-leaderboard-ai-tool'

const mockedSubmit = vi.mocked(submitScore)
const mockedProfileSubmit = vi.mocked(submitArcadeProfileEvent)

// jsdom's `localStorage` in this workspace is a method-less stub (see the
// boot-time `--localstorage-file` warning and the precedent in
// `ResultPage.test.tsx`). Install a Map-backed fake so `getStoredNickname` /
// `setStoredNickname` actually round-trip.
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
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  })
  return store
}

function finishedDailyState(): GameState {
  return {
    status: 'RESULT',
    mode: 'daily',
    manual: null,
    manualUrl: null,
    gameRunId: 'run-daily-result',
    sceneInfo: null,
    moduleSequence: ['wire', 'dial', 'button', 'keypad'],
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
    strikeCount: 0,
    timeBudgetMs: 600_000,
    outcome: 'defused',
    errorMessage: null,
    errorKind: null,
    attemptNumber: 3,
    rngSeed: 12345,
  }
}

function finishedPracticeState(): GameState {
  return { ...finishedDailyState(), mode: 'practice', outcome: 'practice-cleared' }
}

function renderResultPage() {
  return render(
    <MemoryRouter initialEntries={['/bombsquad/result']}>
      <GameProvider>
        <ResultPage />
      </GameProvider>
    </MemoryRouter>
  )
}

describe('ResultPage nickname gate', () => {
  beforeEach(() => {
    installFakeLocalStorage()
    sessionStorage.clear()
    mockedSubmit.mockReset()
    mockedSubmit.mockResolvedValue({ ok: true, data: { rank: 5, total_players: 100 } })
    mockedProfileSubmit.mockReset()
    mockedProfileSubmit.mockResolvedValue({ kind: 'anon' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('first-visit daily run: celebration first, gate opens via the rank-card CTA', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    // Rank-reveal-first ordering (audit F1): the celebration renders
    // unobstructed — no auto-opened modal — and the rank card states the
    // honest not-on-board fact. No submission fires without the gate.
    expect(screen.getByText('拆弹成功')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/这局成绩还没上榜/)).toBeInTheDocument()
    expect(mockedSubmit).not.toHaveBeenCalled()

    // The CTA opens the gate on demand.
    fireEvent.click(screen.getByRole('button', { name: '填写并上榜' }))
    expect(screen.getByRole('dialog', { name: /给自己起个名字/ })).toBeInTheDocument()

    // The confirm button is disabled until a valid nickname and AI tool are set.
    const confirmBtn = screen.getByRole('button', { name: /^确认$/ })
    expect(confirmBtn).toBeDisabled()

    const input = screen.getByLabelText(/昵称/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    expect(confirmBtn).toBeDisabled() // whitespace-only stays disabled

    fireEvent.change(input, { target: { value: '小明' } })
    expect(confirmBtn).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    expect(confirmBtn).toBeEnabled()
    fireEvent.click(confirmBtn)

    // Submission now fires with the typed nickname.
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '小明',
      ai_tool: 'claude',
      device_id: STUB_DEVICE_ID,
      run_id: 'run-daily-result',
    })

    // localStorage persisted the nickname; modal is gone; the rank reveals in
    // place of the not-on-board notice.
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('小明')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('全球排名')).toBeInTheDocument()
  })

  it('skip path: deferring the gate keeps the run off the board with the CTA still offered', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    fireEvent.click(screen.getByRole('button', { name: '填写并上榜' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '稍后再说' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // No submission fired; the honest notice + CTA remain for a later fill.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockedSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/这局成绩还没上榜/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '填写并上榜' })).toBeInTheDocument()
  })

  it('deferred-fill path: reopening the gate after a skip still submits and reveals the rank', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    fireEvent.click(screen.getByRole('button', { name: '填写并上榜' }))
    fireEvent.click(screen.getByRole('button', { name: '稍后再说' }))

    fireEvent.click(screen.getByRole('button', { name: '填写并上榜' }))
    fireEvent.change(screen.getByLabelText(/昵称/), { target: { value: '小明' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    fireEvent.click(screen.getByRole('button', { name: /^确认$/ }))

    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '小明',
      ai_tool: 'claude',
      run_id: 'run-daily-result',
    })
    expect(await screen.findByText('全球排名')).toBeInTheDocument()
  })

  it('returning daily run: cached nickname and AI metadata → submit fires immediately', async () => {
    localStorage.setItem(NICKNAME_KEY, '小红')
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '小红',
      ai_tool: 'chatgpt',
      device_id: STUB_DEVICE_ID,
      run_id: 'run-daily-result',
    })
  })

  it('shows profile save, share, and leaderboard actions on a daily result', async () => {
    const writeText = vi.fn((_: string) => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    localStorage.setItem(NICKNAME_KEY, '小红')
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(await screen.findByText('已保存到本设备')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '分享今日成绩' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看排行榜' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存到我的档案' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '分享今日成绩' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('BombSquad 每日挑战')
    expect(await screen.findByText('分享文案已复制。')).toBeInTheDocument()
  })

  it('does not show a local-save success when local profile persistence fails', async () => {
    localStorage.setItem(NICKNAME_KEY, '小红')
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    const originalSetItem = localStorage.setItem.bind(localStorage)
    localStorage.setItem = vi.fn((key: string, value: string) => {
      if (key === ARCADE_LOCAL_PROFILE_KEY) throw new Error('quota exceeded')
      originalSetItem(key, value)
    })
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(await screen.findByText('本局暂未写入档案')).toBeInTheDocument()
    expect(readArcadeLocalProfile()).toBeNull()
  })

  it('marks auto-synced result profile events as claimed locally', async () => {
    localStorage.setItem(NICKNAME_KEY, '小红')
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    const syncedProfile: ArcadeProfileSummary = {
      profile_id: 'local-profile',
      last_activity_at: '2023-11-14T22:15:50.000Z',
      today_played: true,
      counts: { bombsquad_runs: 1, oracle_signs: 0 },
      bombsquad: { recent: null, best_daily: null, best_practice: null },
      oracle: { recent: null },
      daily_loop: {
        date: '2023-11-14',
        checklist: {
          bombsquad_daily: { completed: true, completed_at: '2023-11-14T22:15:50.000Z' },
          oracle_sign: { completed: false, completed_at: null },
        },
        streak: {
          today_completed: true,
          current_days: 1,
          longest_days: 1,
          last_active_date: '2023-11-14',
        },
      },
    }
    mockedProfileSubmit.mockResolvedValue({
      kind: 'ok',
      profile: syncedProfile,
      publicProfile: { claimed: false, public_label: null },
    })
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(await screen.findByText('已保存到账号档案')).toBeInTheDocument()
    expect(readArcadeLocalProfile()?.claimed_source_keys).toContain('bombsquad:run-daily-result')
  })

  it('practice mode: never shows the modal and never submits', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedPracticeState()))

    renderResultPage()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Flush microtasks — if a stray submit was scheduled it would have fired by now.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockedSubmit).not.toHaveBeenCalled()
    expect(localStorage.getItem(NICKNAME_KEY)).toBeNull()
  })
})
