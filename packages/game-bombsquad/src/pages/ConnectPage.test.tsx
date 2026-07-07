/**
 * ConnectPage unit tests.
 *
 * Covers the connect-AI flow at /bombsquad/connect — the Atlas redesign's
 * 2-step handoff (design_handoff_bombsquad README §6.2):
 *   1. step 1 renders the URL preview with the manual URL.
 *   2. both the manual URL card and the bottom primary CTA「复制手册」copy the
 *      manual link, show the copied feedback, and auto-advance to step 2 after
 *      ~0.7s; if clipboard access fails, the player can manually send the
 *      visible URL and continue. The clipboard payload is the manual URL.
 *   3. step 1 has no disabled / dead control — the affordance-inversion guard.
 *   4. the 2-step state machine reaches the voice-mode step and hands off.
 *   5. daily mode hands off to the run carrying the manual URL as ?url=.
 *   6. practice mode hands off without a ?url= param.
 *   7. step 1 surfaces the /bombsquad/compatibility discovery link
 *      (re-homed from the retired PromptModal).
 *
 * The AI-readiness sync prompt now lives here on step 2, and "进入游戏" starts
 * the run directly — there is no separate GamePage 开始 gate, so this flow ends
 * with a plain navigation and the run auto-starts on the other side.
 *
 * useDailyChallenge is mocked to deterministic URLs; copyToClipboard is
 * stubbed to its success branch so the copy → auto-advance path runs
 * without depending on the jsdom Clipboard API. The navigation target is
 * asserted with a sibling-route location probe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const DAILY_URL = 'https://claw.amio.fans/manual/2026-05-22'
const PRACTICE_URL = 'https://claw.amio.fans/manual/practice'

vi.mock('@/hooks/useDailyChallenge', () => ({
  useDailyChallenge: () => ({
    dailyUrl: DAILY_URL,
    practiceUrl: PRACTICE_URL,
    attemptNumber: 1,
    incrementAttempt: () => {},
  }),
}))

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}))

// These tests cover the anonymous / companion-less flow, which must stay
// byte-identical to the pre-companion-entry behaviour: pin the co-play gate to
// `unavailable`. The companion default entry has its own test file
// (ConnectPage.companion.test.tsx).
vi.mock('@/hooks/useCompanionPartner', () => ({
  useCompanionPartner: () => ({ status: 'unavailable' }),
}))

// The 进入游戏 tap unlocks the shared AudioContext inside the user gesture (iOS
// Safari needs the gesture). Mock the singleton so the test can assert the call
// without a real Web Audio context in jsdom.
vi.mock('@/audio/audio-context', () => ({
  getAudioContext: vi.fn().mockReturnValue(null),
}))

import ConnectPage from './ConnectPage'
import { copyToClipboard } from '@/utils/clipboard'
import { getAudioContext } from '@/audio/audio-context'
import { GameProvider, type GameState } from '@/store/game-context'
import { loadPersistedState, savePersistedState } from '@/store/persistence'

/** The exact AI-readiness sync prompt copy rendered on step 2. */
const SYNC_PROMPT = '等 AI 说完「好了」，点「进入游戏」就开始，计时随即启动。'

const STALE_RESULT_STATE: GameState = {
  status: 'RESULT',
  mode: 'daily',
  manual: null,
  manualUrl: 'https://claw.amio.fans/manual/2026-05-22',
  gameRunId: 'run-stale-result',
  sceneInfo: { sceneTongueTwister: '四是四十是十', batteryCount: 2, indicators: [] },
  moduleSequence: ['wire', 'dial', 'button', 'keypad'],
  moduleConfigs: [null, null, null, null],
  moduleAnswers: [null, null, null, null],
  currentModuleIndex: 4,
  moduleStats: [{ moduleType: 'wire', timeMs: 1000, errorCount: 0 }],
  totalStartTime: 1_700_000_000_000,
  totalEndTime: 1_700_000_001_000,
  currentModuleStartTime: null,
  currentModuleErrorCount: 0,
  strikeCount: 0,
  timeBudgetMs: 3_600_000,
  outcome: 'defused',
  errorMessage: null,
  errorKind: null,
  attemptNumber: 2,
  rngSeed: 123,
}

/* Renders the current location so the run-handoff target is assertable
   without mounting the real GamePage. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderConnect(mode: 'daily' | 'practice') {
  return render(
    <MemoryRouter initialEntries={[`/bombsquad/connect?mode=${mode}`]}>
      <Routes>
        <Route
          path="/bombsquad/connect"
          element={
            <GameProvider>
              <ConnectPage />
            </GameProvider>
          }
        />
        <Route path="/bombsquad/run" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

/* Drive the flow from step 1 to step 2 by tapping the primary copy CTA and
   waiting for the ~0.7s auto-advance to settle. Waiting for step 2 to actually
   render means the auto-advance timer has already fired, so it can never
   race a later manual step change. */
async function copyAndReachStep2() {
  fireEvent.click(screen.getByRole('button', { name: '复制手册' }))
  await waitFor(() => {
    expect(screen.getByText('切到语音模式')).toBeInTheDocument()
  })
}

describe('ConnectPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(copyToClipboard).mockReset()
    vi.mocked(copyToClipboard).mockResolvedValue(true)
    vi.mocked(getAudioContext).mockReset()
    vi.mocked(getAudioContext).mockReturnValue(null)
  })

  it('renders step 1 with the URL preview and manual URL', () => {
    renderConnect('daily')

    expect(screen.getByText('第 1/2 步')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /发给 AI/ })).toBeInTheDocument()
    // The preview surfaces the manual link only — no opening prompt.
    expect(screen.getByText('手册链接')).toBeInTheDocument()
    expect(screen.getByText(DAILY_URL)).toBeInTheDocument()
  })

  it('makes the manual URL card and primary CTA active copy controls on step 1', () => {
    renderConnect('daily')

    const copyCard = screen.getByRole('button', { name: '复制手册链接' })
    expect(copyCard).toBeInTheDocument()
    expect(copyCard).not.toBeDisabled()

    // The affordance-inversion guard: the bottom primary CTA is also the real
    // copy action ("复制手册"), and step 1 has no disabled / dead control.
    const copyCta = screen.getByRole('button', { name: '复制手册' })
    expect(copyCta).toBeInTheDocument()
    expect(copyCta).not.toBeDisabled()

    // No button on step 1 is disabled (the back-arrow icon button is enabled
    // too, so the assertion covers every button rendered here).
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).not.toBeDisabled()
    }

    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('surfaces the /bombsquad/compatibility discovery link on step 1', () => {
    renderConnect('daily')

    // The link re-homes the entry point lost when PromptModal was removed;
    // it must point at the /bombsquad/compatibility route to keep that page
    // reachable.
    const compatLink = screen.getByRole('link', { name: /查看支持工具/ })
    expect(compatLink).toBeInTheDocument()
    expect(compatLink).toHaveAttribute('href', '/bombsquad/compatibility')
  })

  it('copies the manual link from the primary CTA and auto-advances to step 2 after ~0.7s', async () => {
    renderConnect('practice')

    fireEvent.click(screen.getByRole('button', { name: '复制手册' }))

    // Copy action — the CTA flips to its copied state and the preview turns
    // green ("已复制到剪贴板").
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已复制 ✓' })).toBeInTheDocument()
    })
    expect(screen.getByText('已复制到剪贴板')).toBeInTheDocument()
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    // The clipboard payload is the manual URL alone.
    expect(copyToClipboard).toHaveBeenCalledWith(PRACTICE_URL)

    // ~0.7s auto-advance — step 2 (voice mode) takes over in place.
    await waitFor(() => {
      expect(screen.getByText('切到语音模式')).toBeInTheDocument()
    })
  })

  it('copies the manual link from the URL card too', async () => {
    renderConnect('practice')

    fireEvent.click(screen.getByRole('button', { name: '复制手册链接' }))

    await waitFor(() => {
      expect(screen.getByText('已复制到剪贴板')).toBeInTheDocument()
    })
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    expect(copyToClipboard).toHaveBeenCalledWith(PRACTICE_URL)

    await waitFor(() => {
      expect(screen.getByText('切到语音模式')).toBeInTheDocument()
    })
  })

  it('lets the player continue manually if clipboard copy fails', async () => {
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false)
    renderConnect('practice')

    fireEvent.click(screen.getByRole('button', { name: '复制手册' }))

    await waitFor(() => {
      expect(screen.getByText('复制失败，链接仍可用')).toBeInTheDocument()
    })
    expect(screen.getByText(/上面的链接就是同一份手册/)).toBeInTheDocument()
    expect(screen.getByText(/和复制后粘贴完全一样/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试复制' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试复制手册链接' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /我已手动发给 AI/ }))

    expect(screen.getByText('第 2/2 步')).toBeInTheDocument()
    expect(screen.getByText(SYNC_PROMPT)).toBeInTheDocument()
  })

  it('walks the 2-step state machine to the voice-mode step', async () => {
    renderConnect('practice')

    // Step 1 → step 2 via copy + auto-advance.
    await copyAndReachStep2()

    // Step 2 — the voice-mode step, carrying the AI-readiness sync prompt and
    // the run handoff CTA. 进入游戏 starts the run directly; there is no separate
    // GamePage 开始 gate.
    expect(screen.getByText('第 2/2 步')).toBeInTheDocument()
    expect(screen.getByText('切到语音模式')).toBeInTheDocument()
    // The sync prompt re-homed from the deleted GamePage 开始 gate: it confirms
    // the AI said「好了」and names the one consequence of the next tap (进入即计时).
    expect(screen.getByText(SYNC_PROMPT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /进入游戏/ })).toBeInTheDocument()
  })

  it('unlocks the AudioContext when 进入游戏 is tapped (daily)', async () => {
    renderConnect('daily')

    await copyAndReachStep2()
    // No audio unlock has happened yet — it must fire on the run-handoff gesture,
    // not on render or on the copy step.
    expect(getAudioContext).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /进入游戏/ }))

    // iOS Safari only permits audio to start from inside a user gesture, so the
    // 进入游戏 tap is where the shared AudioContext gets unlocked.
    expect(getAudioContext).toHaveBeenCalledTimes(1)
  })

  it('clears stale persisted result state before entering a new run', async () => {
    savePersistedState(STALE_RESULT_STATE)
    expect(loadPersistedState()?.status).toBe('RESULT')

    renderConnect('practice')

    await copyAndReachStep2()
    fireEvent.click(screen.getByRole('button', { name: /进入游戏/ }))

    expect(loadPersistedState()).toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent('/bombsquad/run?mode=practice')
  })

  it('unlocks the AudioContext when 进入游戏 is tapped (practice)', async () => {
    renderConnect('practice')

    await copyAndReachStep2()
    expect(getAudioContext).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /进入游戏/ }))

    expect(getAudioContext).toHaveBeenCalledTimes(1)
  })

  it('hands daily mode off to the run carrying the manual URL as ?url=', async () => {
    renderConnect('daily')

    await copyAndReachStep2()
    fireEvent.click(screen.getByRole('button', { name: /进入游戏/ }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/bombsquad/run')
    expect(location).toContain('mode=daily')
    expect(location).toContain(`url=${encodeURIComponent(DAILY_URL)}`)
  })

  it('hands practice mode off to the run without a ?url= param', async () => {
    renderConnect('practice')

    await copyAndReachStep2()
    fireEvent.click(screen.getByRole('button', { name: /进入游戏/ }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toBe('/bombsquad/run?mode=practice')
    expect(location).not.toContain('url=')
  })
})
