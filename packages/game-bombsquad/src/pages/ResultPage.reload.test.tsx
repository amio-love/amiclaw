/**
 * ResultPage reload / re-entry submission-guard tests (gate F1).
 *
 * The finished RESULT state persists to sessionStorage, so a reload — or a
 * full-page nav to /leaderboard then Back on a browser that skips bfcache —
 * re-mounts ResultPage. Without a per-run guard the auto-submit effect re-POSTs
 * the same run; the backend's 10s device rate-limit rejects it with 429 and the
 * settlement flips the just-earned rank into a false「提交太频繁」. These tests pin
 * the fix:
 *   (1) a reload after a successful submission renders the earned rank and never
 *       re-POSTs (no second submit, no profile re-fetch);
 *   (2) a 429 arriving for a run already recorded on the board (marker present)
 *       re-renders the earned rank instead of the failure copy.
 *
 * Setup mirrors ResultPage.submission.test.tsx: pre-seed sessionStorage with a
 * finished daily game state so GameProvider hydrates straight into ResultPage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
import { GameProvider, type GameState } from '@/store/game-context'
import { writeSubmittedRun } from '@/utils/submitted-run'

const PERSISTENCE_KEY = 'bombsquad:game-state:v4'
const AI_TOOL_KEY = 'bombsquad-leaderboard-ai-tool'
const RUN_ID = 'run-daily-result'

const mockedSubmit = vi.mocked(submitScore)
const mockedProfileSubmit = vi.mocked(submitArcadeProfileEvent)
const mockedFetchProfile = vi.mocked(fetchArcadeProfile)

function okProfile(publicLabel: string | null): ArcadeProfileReadResult {
  return {
    kind: 'ok',
    profile: undefined as unknown as ArcadeProfileSummary,
    publicProfile: { claimed: publicLabel !== null, public_label: publicLabel },
  }
}

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
    gameRunId: RUN_ID,
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

function renderResultPage() {
  return render(
    <MemoryRouter initialEntries={['/bombsquad/result']}>
      <GameProvider>
        <ResultPage />
      </GameProvider>
    </MemoryRouter>
  )
}

describe('ResultPage reload after a daily submission (gate F1)', () => {
  beforeEach(() => {
    installFakeLocalStorage()
    sessionStorage.clear()
    mockedSubmit.mockReset()
    mockedProfileSubmit.mockReset()
    mockedProfileSubmit.mockResolvedValue({ kind: 'anon' })
    mockedFetchProfile.mockReset()
    mockedFetchProfile.mockResolvedValue(okProfile('公开名'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('renders the earned rank on reload and never re-POSTs (no second submit, no profile re-fetch)', async () => {
    // A reload within the 10s window: the RESULT state is persisted AND the
    // successful submission left a per-run marker with the earned rank.
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))
    writeSubmittedRun(RUN_ID, { rank: 5, total_players: 100, personal_best_ms: 150_000 })

    renderResultPage()

    // The earned rank shows immediately from the marker.
    expect(await screen.findByText('全球排名')).toBeInTheDocument()
    expect(screen.getByText('#5')).toBeInTheDocument()

    // No re-submission and no wasted profile round-trip: the run is already on
    // the board, so the auto-submit effect short-circuits entirely.
    expect(mockedSubmit).not.toHaveBeenCalled()
    expect(mockedFetchProfile).not.toHaveBeenCalled()

    // The false「提交太频繁」copy never appears.
    expect(screen.queryByText(/提交太频繁/)).not.toBeInTheDocument()
    expect(screen.queryByText(/提交失败/)).not.toBeInTheDocument()
  })

  it('treats a 429 for an already-boarded run as success, not a failure', async () => {
    // No marker at mount, so the auto-submit effect DOES fire a POST. By the
    // time that POST is rejected with 429, the run is already recorded (marker
    // present) — the settlement must render the earned rank, not「提交太频繁」.
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))
    mockedSubmit.mockImplementation(async (submission) => {
      writeSubmittedRun(submission.run_id as string, { rank: 7, total_players: 42 })
      return { ok: false, kind: 'rejected', status: 429 }
    })

    renderResultPage()

    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1))

    expect(await screen.findByText('全球排名')).toBeInTheDocument()
    expect(screen.getByText('#7')).toBeInTheDocument()
    expect(screen.queryByText(/提交太频繁/)).not.toBeInTheDocument()
  })
})
