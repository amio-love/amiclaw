/**
 * ResultPage replay_intent event-log test.
 *
 * Asserts that clicking "再来一局" issues a single POST to `/api/events`
 * whose JSON body satisfies `{ event: 'replay_intent', data: { mode,
 * attemptNumber } }`. This is the data point roadmap §Strategic Objectives
 * Validation Criteria #3 (复玩意愿 ≥50%) is estimated from during the
 * manual-metrics window.
 *
 * Setup approach: pre-seed sessionStorage with a finished-game (RESULT) state
 * so `GameProvider`'s lazy initializer hydrates straight into a renderable
 * ResultPage, instead of driving the 4-module flow end-to-end (which is
 * already covered by `game-flow.test.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `logEvent` reads `getDeviceId()` (which hits localStorage) when building
// the POST body. The vitest jsdom env in this workspace has a non-functional
// localStorage (`--localstorage-file` warning), so we stub the fingerprint
// module to a deterministic UUID. `vi.hoisted` makes the value reachable
// from the hoisted `vi.mock` factory without TDZ.
const { STUB_DEVICE_ID } = vi.hoisted(() => ({
  STUB_DEVICE_ID: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))
vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => STUB_DEVICE_ID,
}))

// Mock the leaderboard API so each test can control the score-submission
// promise resolution shape (and therefore the rankResult state that
// buildSummary reads from). Tests below override the resolved value per case
// via `vi.mocked(submitScore).mockResolvedValueOnce(...)`.
vi.mock('@/utils/leaderboard-api', () => ({
  submitScore: vi.fn(),
}))

import ResultPage from './ResultPage'
import { GameProvider, type GameState } from '@/store/game-context'
import { submitScore } from '@/utils/leaderboard-api'
import * as clipboardModule from '@/utils/clipboard'

const PERSISTENCE_KEY = 'bombsquad:game-state:v1'

function finishedPracticeState(): GameState {
  // Seed `attemptNumber` to a non-default value (7), distinct from
  // INITIAL_STATE.attemptNumber (=1). This protects against any refactor that
  // accidentally reads the post-RESET state when emitting `replay_intent` —
  // e.g. a future change that re-reads from a freshly-dispatched store
  // snapshot (selector hook, ref, or restructured imperative read) instead of
  // the closure's pre-RESET `state` — which would surface as `attemptNumber: 1`
  // in the captured payload and fail the assertion below loud. Note: the
  // current implementation captures `state.attemptNumber` from the React
  // closure, so a literal swap of `logEvent` and `dispatch({type:'RESET'})`
  // call lines alone would NOT change the captured value (the closure is
  // pinned at render time); the seed defends the broader call-order intent.
  return {
    status: 'RESULT',
    mode: 'practice',
    manual: null,
    manualUrl: null,
    sceneInfo: null,
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
    errorMessage: null,
    errorKind: null,
    attemptNumber: 7,
    rngSeed: 12345,
  }
}

describe('ResultPage replay_intent logging', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedPracticeState()))
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('POSTs replay_intent with mode and attemptNumber when "再来一局" is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/result']}>
        <GameProvider>
          <ResultPage />
        </GameProvider>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: '再来一局' }))

    // Filter to /api/events POSTs whose body declares event: replay_intent —
    // defensive against any future event that might be emitted on the same
    // path. The contract is "exactly one replay_intent per click", not
    // "no other events".
    const replayCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
      const [url, init] = call as [string, RequestInit | undefined]
      if (url !== '/api/events') return false
      if (!init || typeof init.body !== 'string') return false
      try {
        const body = JSON.parse(init.body) as { event?: string }
        return body.event === 'replay_intent'
      } catch {
        return false
      }
    })
    expect(replayCalls).toHaveLength(1)

    const [, init] = replayCalls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      event: 'replay_intent',
      data: { mode: 'practice', attemptNumber: 7 },
    })
    expect(typeof body.timestamp).toBe('string')
    expect(body.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })
})

// ---------------------------------------------------------------------------
// buildSummary recap-format integration tests (spec §5.3 wire-up)
//
// These cover the data-layer wiring landed in PR #71:
//   - response.personal_best_ms / personal_best_attempt → "今日最佳" line
//   - buildRetroQuestions(stats, attempt, mode) → three "- " bulleted prompts
//
// Strategy: render ResultPage with seeded RESULT-state, let the on-mount
// submitScore mock resolve, then click "复制赛后摘要". The copied text is
// captured by spying on copyToClipboard (the prod entry point used by the
// click handler) and asserted on substring-by-substring.
// ---------------------------------------------------------------------------

function finishedDailyState(overrides: Partial<GameState> = {}): GameState {
  // Module times here are tuned so the slowest module is index 1 (dial,
  // "密码盘"), matching the directive's case (e) "Q1 names slowest module"
  // wire-up assertion. totalEndTime - totalStartTime = 221_000 ms → 03:41.
  return {
    status: 'RESULT',
    mode: 'daily',
    manual: null,
    manualUrl: null,
    sceneInfo: null,
    moduleConfigs: [null, null, null, null],
    moduleAnswers: [null, null, null, null],
    currentModuleIndex: 4,
    moduleStats: [
      { moduleType: 'wire', timeMs: 30_000, errorCount: 0 },
      { moduleType: 'dial', timeMs: 105_000, errorCount: 1 }, // longest
      { moduleType: 'button', timeMs: 38_000, errorCount: 0 },
      { moduleType: 'keypad', timeMs: 48_000, errorCount: 0 },
    ],
    totalStartTime: 1_700_000_000_000,
    totalEndTime: 1_700_000_221_000,
    currentModuleStartTime: null,
    currentModuleErrorCount: 0,
    errorMessage: null,
    errorKind: null,
    attemptNumber: 3,
    rngSeed: 12345,
    ...overrides,
  }
}

describe('ResultPage buildSummary recap format', () => {
  let copySpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    sessionStorage.clear()
    // copyToClipboard reads via `clipboardModule` namespace import in tests;
    // the production click handler imports it as a named binding. The spy
    // intercepts the namespace property the test reads, and the named
    // binding in ResultPage.tsx resolves to the same module record at runtime,
    // so the spy fires for both.
    copySpy = vi.spyOn(clipboardModule, 'copyToClipboard').mockResolvedValue(true)
    vi.mocked(submitScore).mockReset()
  })

  afterEach(() => {
    sessionStorage.clear()
    copySpy.mockRestore()
  })

  function getCopiedText(): string {
    expect(copySpy).toHaveBeenCalledTimes(1)
    const arg = copySpy.mock.calls[0][0]
    expect(typeof arg).toBe('string')
    return arg as string
  }

  it('(a) daily mode with full personal-best includes "今日最佳：MM:SS（第 N 次）" and three retro bullets', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))
    vi.mocked(submitScore).mockResolvedValueOnce({
      rank: 5,
      total_players: 100,
      personal_best_ms: 195_000, // 03:15
      personal_best_attempt: 2,
    })

    render(
      <MemoryRouter initialEntries={['/result']}>
        <GameProvider>
          <ResultPage />
        </GameProvider>
      </MemoryRouter>
    )

    // Wait for the on-mount submitScore promise to flush rankResult into state.
    await waitFor(() => {
      expect(screen.getByText(/全球排名/)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '复制赛后摘要' }))

    const text = getCopiedText()
    expect(text).toContain('今日最佳：03:15（第 2 次）')
    expect(text).toContain('全球排名：#5 / 100')
    const bulletLines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(bulletLines).toHaveLength(3)
  })

  it('(b) daily mode with legacy personal-best (no attempt_number) omits the "（第 N 次）" suffix', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))
    vi.mocked(submitScore).mockResolvedValueOnce({
      rank: 5,
      total_players: 100,
      personal_best_ms: 195_000,
      // personal_best_attempt intentionally absent — legacy KV record shape
    })

    render(
      <MemoryRouter initialEntries={['/result']}>
        <GameProvider>
          <ResultPage />
        </GameProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/全球排名/)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '复制赛后摘要' }))

    const text = getCopiedText()
    // The personal-best line itself must NOT carry the attempt-number suffix,
    // but the mode label ("每日挑战（第 3 次尝试）") still legitimately includes
    // "（第" — so assert on the personal-best line specifically.
    const personalBestLine = text.split('\n').find((l) => l.startsWith('今日最佳：'))
    expect(personalBestLine).toBe('今日最佳：03:15')
  })

  it('(c) practice mode omits 今日最佳 and 全球排名 but still includes three retro bullets', () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedPracticeState()))
    // Practice mode never invokes submitScore, so no mock setup needed.

    render(
      <MemoryRouter initialEntries={['/result']}>
        <GameProvider>
          <ResultPage />
        </GameProvider>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: '复制赛后摘要' }))

    const text = getCopiedText()
    expect(text).not.toContain('今日最佳')
    expect(text).not.toContain('全球排名')
    const bulletLines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(bulletLines).toHaveLength(3)
    expect(submitScore).not.toHaveBeenCalled()
  })

  it('(d) daily mode with unresolved submission omits both 今日最佳 and 全球排名 lines', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))
    // Resolve to null — simulates a failed submission (offline / 5xx).
    // rankResult stays null, so buildSummary should skip both lines.
    vi.mocked(submitScore).mockResolvedValueOnce(null)

    render(
      <MemoryRouter initialEntries={['/result']}>
        <GameProvider>
          <ResultPage />
        </GameProvider>
      </MemoryRouter>
    )

    // Wait for the submit promise to settle so we don't race the click.
    await waitFor(() => {
      expect(vi.mocked(submitScore)).toHaveBeenCalled()
    })
    // Let microtasks drain so `.then((result) => …)` has run.
    await Promise.resolve()
    await Promise.resolve()

    fireEvent.click(screen.getByRole('button', { name: '复制赛后摘要' }))

    const text = getCopiedText()
    expect(text).not.toContain('今日最佳：')
    expect(text).not.toContain('全球排名：')
  })

  it('(e) Q1 names the slowest module ("密码盘") end-to-end', async () => {
    sessionStorage.setItem(PERSISTENCE_KEY, JSON.stringify(finishedDailyState()))
    vi.mocked(submitScore).mockResolvedValueOnce({
      rank: 5,
      total_players: 100,
      personal_best_ms: 195_000,
      personal_best_attempt: 2,
    })

    render(
      <MemoryRouter initialEntries={['/result']}>
        <GameProvider>
          <ResultPage />
        </GameProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/全球排名/)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '复制赛后摘要' }))

    const text = getCopiedText()
    const bulletLines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(bulletLines).toHaveLength(3)
    expect(bulletLines[0]).toContain('密码盘模块耗时最长')
  })
})
