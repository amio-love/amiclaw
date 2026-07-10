/**
 * ResultPage daily-submission conversion tests (ruling B).
 *
 * The nickname gate and the「填写并上榜」button are retired. A won daily run now
 * resolves its identity once and, when signed in, auto-submits under the unified
 * username with no user action. The leaderboard `ai_tool` is resolved
 * inference-first. Covered branches:
 *   (a) returning signed-in run → auto-submit under `public_label`, stored tool.
 *   (b) first-time companion co-play (mode②) → auto-submit, tool inferred as the
 *       platform companion, never asked.
 *   (c) first-time BYO run → one inline row of SSOT chips; the pick is
 *       remembered and the run auto-submits.
 *   (d) anonymous run → ONE calm login invite; declining writes nothing.
 *   (e) anonymous run → tapping the invite hands off to /login.
 *   (f) signed-in with no name yet → a 去设置名字 invite, no board write.
 *   plus: practice never submits; the arcade-profile save states still render.
 *
 * Setup mirrors the sibling ResultPage tests: pre-seed sessionStorage with a
 * finished game state so `GameProvider` hydrates straight into a renderable
 * ResultPage.
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

vi.mock('@/utils/event-log', () => ({
  logEvent: vi.fn(),
}))

// Pin the survey off — this suite exercises only the leaderboard submission
// path. The survey fold-in has its own coverage in ResultPage.survey.test.tsx.
vi.mock('@/utils/survey', () => ({
  hasAnsweredSurvey: () => true,
  markSurveyAnswered: vi.fn(),
}))

vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: vi.fn(),
  fetchArcadeProfile: vi.fn(),
}))

import ResultPage from './ResultPage'
import { submitScore } from '@shared/leaderboard-api'
import {
  fetchArcadeProfile,
  submitArcadeProfileEvent,
  type ArcadeProfileReadResult,
} from '@amiclaw/arcade-profile/api-client'
import type { ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import { ARCADE_LOCAL_PROFILE_KEY, readArcadeLocalProfile } from '@amiclaw/arcade-profile/local'
import { GameProvider, type GameState } from '@/store/game-context'

const PERSISTENCE_KEY = 'bombsquad:game-state:v4'
const ENTRY_RECOVERY_KEY = 'bombsquad:entry-recovery'
const NICKNAME_KEY = 'bombsquad-nickname'
const AI_TOOL_KEY = 'bombsquad-leaderboard-ai-tool'

const mockedSubmit = vi.mocked(submitScore)
const mockedProfileSubmit = vi.mocked(submitArcadeProfileEvent)
const mockedFetchProfile = vi.mocked(fetchArcadeProfile)

/** A signed-in profile read. `publicLabel === null` is the "no name yet" case. */
function okProfile(publicLabel: string | null): ArcadeProfileReadResult {
  return {
    kind: 'ok',
    profile: undefined as unknown as ArcadeProfileSummary,
    publicProfile: { claimed: publicLabel !== null, public_label: publicLabel },
  }
}

// jsdom's workspace `localStorage` is a method-less stub; install a Map-backed
// fake so the metadata + nickname helpers actually round-trip.
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

/** Seed the entry-recovery record so a mode② (platform companion) run is
 *  detected — the companion-inference path (b). */
function seedCompanionRun() {
  sessionStorage.setItem(
    ENTRY_RECOVERY_KEY,
    JSON.stringify({
      mode: 'daily',
      manualUrl: 'https://example.com/manual',
      manualHandoffComplete: true,
      platformPartner: true,
    })
  )
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

describe('ResultPage daily submission (ruling B)', () => {
  beforeEach(() => {
    installFakeLocalStorage()
    sessionStorage.clear()
    mockedSubmit.mockReset()
    mockedSubmit.mockResolvedValue({ ok: true, data: { rank: 5, total_players: 100 } })
    mockedProfileSubmit.mockReset()
    mockedProfileSubmit.mockResolvedValue({ kind: 'anon' })
    mockedFetchProfile.mockReset()
    mockedFetchProfile.mockResolvedValue({ kind: 'anon' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('(a) returning signed-in run: auto-submits under public_label + stored tool, no ask', async () => {
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    mockedFetchProfile.mockResolvedValue(okProfile('公开名'))
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    // No dialog, no chip ask, no fill-and-rank button — the run just submits.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('和哪个 AI 一起玩的？')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '填写并上榜' })).not.toBeInTheDocument()

    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '公开名',
      ai_tool: 'chatgpt',
      device_id: STUB_DEVICE_ID,
      run_id: 'run-daily-result',
    })
    expect(await screen.findByText('全球排名')).toBeInTheDocument()
  })

  it('(b) first-time companion co-play: auto-submits with the tool inferred, never asked', async () => {
    // No stored tool — the tool comes purely from the mode② inference.
    seedCompanionRun()
    mockedFetchProfile.mockResolvedValue(okProfile('公开名'))
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(screen.queryByText('和哪个 AI 一起玩的？')).not.toBeInTheDocument()
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '公开名',
      ai_tool: 'companion',
      run_id: 'run-daily-result',
    })
  })

  it('(c) first-time BYO run: asks once with SSOT chips, remembers the pick, then submits', async () => {
    mockedFetchProfile.mockResolvedValue(okProfile('公开名'))
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    // The inline chip row appears once identity resolves; nothing submits yet.
    expect(await screen.findByText('和哪个 AI 一起玩的？')).toBeInTheDocument()
    // Only the three SSOT tools (no 8-way sprawl, no 其他).
    expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ChatGPT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gemini' })).toBeInTheDocument()
    expect(mockedSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }))

    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      nickname: '公开名',
      ai_tool: 'chatgpt',
      run_id: 'run-daily-result',
    })
    // Remembered for next time.
    expect(localStorage.getItem(AI_TOOL_KEY)).toBe('chatgpt')
    expect(await screen.findByText('全球排名')).toBeInTheDocument()
  })

  it('(d) anonymous run: shows ONE login invite and writes nothing to the board', async () => {
    mockedFetchProfile.mockResolvedValue({ kind: 'anon' })
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(await screen.findByText(/登录后自动记录成绩/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument()
    // No stacked celebration/consolation invite, no chip ask.
    expect(screen.queryByText('和哪个 AI 一起玩的？')).not.toBeInTheDocument()

    // Declining (never tapping the invite) writes nothing.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockedSubmit).not.toHaveBeenCalled()
  })

  it('(e) anonymous run: tapping the invite hands off to /login', async () => {
    mockedFetchProfile.mockResolvedValue({ kind: 'anon' })
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    const assign = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    })

    try {
      renderResultPage()
      const invite = await screen.findByRole('button', { name: /登录/ })
      fireEvent.click(invite)
      expect(assign).toHaveBeenCalledWith('/login')
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('(f) signed-in but no name yet: offers a 去设置名字 invite, writes nothing', async () => {
    mockedFetchProfile.mockResolvedValue(okProfile(null))
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))

    renderResultPage()

    expect(await screen.findByText(/给自己起个名字/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /去设置名字/ })).toBeInTheDocument()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockedSubmit).not.toHaveBeenCalled()
  })

  it('practice mode: never resolves identity and never submits', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedPracticeState()))

    renderResultPage()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockedSubmit).not.toHaveBeenCalled()
    expect(mockedFetchProfile).not.toHaveBeenCalled()
  })

  it('arcade profile: does not show a local-save success when local persistence fails', async () => {
    localStorage.setItem(NICKNAME_KEY, '小红')
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    mockedFetchProfile.mockResolvedValue(okProfile('公开名'))
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

  it('arcade profile: marks auto-synced result profile events as claimed locally', async () => {
    localStorage.setItem(NICKNAME_KEY, '小红')
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    mockedFetchProfile.mockResolvedValue(okProfile('公开名'))
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
      history: [],
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
})
