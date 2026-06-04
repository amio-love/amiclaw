/**
 * ResultPage nickname-gate integration tests.
 *
 * Covers the three branches of the daily-mode submission flow:
 *   1. First-visit daily run, localStorage empty → PostGameModal renders the
 *      nickname section, the score is NOT submitted, and submission only fires
 *      after the player types a valid nickname and confirms.
 *   2. Returning daily run, localStorage already has a nickname → no modal,
 *      the score is submitted immediately with the cached nickname.
 *   3. Practice mode → no modal, no submit (practice never posts a score).
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
import { GameProvider, type GameState } from '@/store/game-context'

const PERSISTENCE_KEY = 'bombsquad:game-state:v2'
const NICKNAME_KEY = 'bombsquad-nickname'

const mockedSubmit = vi.mocked(submitScore)

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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('first-visit daily run: shows modal, blocks submit until the player confirms', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    // Modal is visible and blocks submission.
    expect(screen.getByRole('dialog', { name: /给自己起个名字/ })).toBeInTheDocument()
    expect(mockedSubmit).not.toHaveBeenCalled()

    // The confirm button is disabled until a valid nickname is typed.
    const confirmBtn = screen.getByRole('button', { name: /^确认$/ })
    expect(confirmBtn).toBeDisabled()

    const input = screen.getByLabelText(/昵称/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    expect(confirmBtn).toBeDisabled() // whitespace-only stays disabled

    fireEvent.change(input, { target: { value: '小明' } })
    expect(confirmBtn).toBeEnabled()
    fireEvent.click(confirmBtn)

    // Submission now fires with the typed nickname.
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '小明',
      device_id: STUB_DEVICE_ID,
    })

    // localStorage persisted the nickname; modal is gone.
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('小明')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('returning daily run: cached nickname → modal does not render, submit fires immediately', async () => {
    localStorage.setItem(NICKNAME_KEY, '小红')
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '小红',
      device_id: STUB_DEVICE_ID,
    })
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
