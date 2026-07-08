/**
 * F-D regression: result-page share must degrade gracefully and never dead-end
 * in a bare 「分享失败」 (audit F26, reproduced on a real phone).
 *
 * Ladder:
 *   1. Web Share API present + resolves        → 「已打开系统分享。」
 *   2. Web Share API present + user cancels     → silent (AbortError is not a
 *      failure; no error line, no fallback UI)
 *   3. Web Share API present + real rejection   → falls back to clipboard copy
 *   4. No Web Share, clipboard blocked too      → select-and-copy fallback UI,
 *      never a bare failure message
 *
 * Setup mirrors ResultPage.nickname.test.tsx: pre-seed a finished daily run so
 * the daily-loop card (which carries 分享今日成绩) renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))

vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn().mockResolvedValue({ ok: true, data: { rank: 5, total_players: 100 } }),
  fetchLeaderboard: vi.fn(),
}))

vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))
vi.mock('@/utils/survey', () => ({ hasAnsweredSurvey: () => true, markSurveyAnswered: vi.fn() }))
vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: vi.fn().mockResolvedValue({ kind: 'anon' }),
}))

import ResultPage from './ResultPage'
import { GameProvider, type GameState } from '@/store/game-context'

const PERSISTENCE_KEY = 'bombsquad:game-state:v4'
const NICKNAME_KEY = 'bombsquad-nickname'
const AI_TOOL_KEY = 'bombsquad-leaderboard-ai-tool'

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

function finishedDailyState(): GameState {
  return {
    status: 'RESULT',
    mode: 'daily',
    manual: null,
    manualUrl: null,
    gameRunId: 'run-daily-share',
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

async function clickShare() {
  const btn = await screen.findByRole('button', { name: '分享今日成绩' })
  fireEvent.click(btn)
}

describe('ResultPage share fallback ladder (F-D)', () => {
  beforeEach(() => {
    installFakeLocalStorage()
    sessionStorage.clear()
    localStorage.setItem(NICKNAME_KEY, '小红')
    localStorage.setItem(AI_TOOL_KEY, 'chatgpt')
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('uses the Web Share API when present and succeeds', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, share })

    renderResultPage()
    await clickShare()

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(share.mock.calls[0][0]).toMatchObject({ text: expect.stringContaining('BombSquad') })
    expect(await screen.findByText('已打开系统分享。')).toBeInTheDocument()
  })

  it('treats a user-canceled share (AbortError) as silent, not a failure', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('canceled', 'AbortError'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText } })

    renderResultPage()
    await clickShare()

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    // A cancel neither copies nor shows any status/failure line.
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText('已打开系统分享。')).not.toBeInTheDocument()
    expect(screen.queryByText(/不支持一键分享/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('分享文案')).not.toBeInTheDocument()
  })

  it('falls back to clipboard copy when a present share API really fails', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText } })

    renderResultPage()
    await clickShare()

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('BombSquad 每日挑战')
    expect(await screen.findByText('分享文案已复制。')).toBeInTheDocument()
  })

  it('offers a select-and-copy field when neither share nor clipboard is usable', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    // jsdom does not implement execCommand; define it as a failing stub so the
    // legacy clipboard path in copyToClipboard also fails on this device.
    ;(document as unknown as { execCommand: () => boolean }).execCommand = () => false

    renderResultPage()
    await clickShare()

    // No bare 「分享失败」 — the share text is surfaced for manual selection.
    const field = (await screen.findByLabelText('分享文案')) as HTMLTextAreaElement
    expect(field.value).toContain('BombSquad 每日挑战')
    expect(screen.getByText(/不支持一键分享/)).toBeInTheDocument()
    expect(screen.queryByText('分享失败，请稍后再试。')).not.toBeInTheDocument()
  })
})
