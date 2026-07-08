/**
 * GamePage closing-recap gating tests.
 *
 * After a successful daily defuse with the platform voice partner active, the
 * `RESULT` effect in GamePage must:
 *   1. Call `voicePanelRef.current.requestClosing()` before navigating.
 *   2. Navigate to `/bombsquad/result` only after the returned promise settles.
 *   3. Navigate anyway if the promise rejects (error-recovery fallback, covering
 *      the same `doNavigate` code path as the 8000ms hard-timeout sentinel).
 *
 * Approach: mock `useVoiceSession` at the boundary between GamePage → VoicePanel →
 * hook. The real VoicePanel (with its `forwardRef` + `useImperativeHandle`) is
 * left intact; only the hook it calls is replaced with a controlled stub. This
 * threads `requestClosing` through the real ref path so the GamePage effect
 * exercises the same `voicePanelRef.current.requestClosing()` call it would in
 * production.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import yaml from 'js-yaml'
import type { Manual } from '@shared/manual-schema'
import App from './App'
import practiceYamlRaw from '../../manual/data/practice.yaml?raw'

// --- Mock: module components (fast, no puzzle logic) -----------------------------

vi.mock('./modules/wire/WireModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-wire-complete" onClick={onComplete}>
      complete-wire
    </button>
  ),
}))
vi.mock('./modules/dial/DialModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-dial-complete" onClick={onComplete}>
      complete-dial
    </button>
  ),
}))
vi.mock('./modules/button/ButtonModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-button-complete" onClick={onComplete}>
      complete-button
    </button>
  ),
}))
vi.mock('./modules/keypad/KeypadModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-keypad-complete" onClick={onComplete}>
      complete-keypad
    </button>
  ),
}))

// --- Mock: leaderboard API -------------------------------------------------------

vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn().mockResolvedValue({ ok: true, data: { rank: 1, total_players: 10 } }),
  fetchLeaderboard: vi.fn().mockResolvedValue({ date: '2026-06-30', entries: [] }),
}))

// --- Mock: daily manual loader --------------------------------------------------

vi.mock('@/utils/yaml-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/yaml-loader')>()
  return { ...actual, loadManual: vi.fn() }
})
import { loadManual } from '@/utils/yaml-loader'

// --- Mock: event-log (no-op) ----------------------------------------------------

vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))

// --- Mock: closing-recap dedup log ----------------------------------------------

const recapLog = vi.hoisted(() => ({ record: vi.fn() }))
vi.mock('@/voice/closing-recap-log', () => ({
  recordClosingRecapFired: recapLog.record,
  wasClosingRecapFired: () => false,
}))

// --- Mock: useVoiceSession with controllable requestClosing ----------------------

/**
 * `vi.hoisted` so the mock factory closure below AND the test body both share the
 * same functions. The factory runs before imports are executed; hoisted values are
 * the only safe escape hatch.
 */
const closingControl = vi.hoisted(() => {
  let pendingResolve: (() => void) | null = null
  let pendingReject: ((err: Error) => void) | null = null

  const requestClosing = vi.fn()

  return {
    requestClosing,
    /** Resolve the current pending requestClosing promise (recap finished). */
    resolveClosing: () => {
      pendingResolve?.()
      pendingResolve = null
    },
    /** Reject the current pending requestClosing promise (recap errored). */
    rejectClosing: (err: Error) => {
      pendingReject?.(err)
      pendingReject = null
    },
    /** Install (or re-install) the pending-promise implementation. */
    setupPending: () => {
      requestClosing.mockImplementation(
        () =>
          new Promise<void>((res, rej) => {
            pendingResolve = res
            pendingReject = rej
          })
      )
    },
  }
})

vi.mock('@/voice/useVoiceSession', () => ({
  useVoiceSession: () => ({
    status: 'ready' as const,
    conversationPhase: 'listening' as const,
    playerSpeaking: false,
    aiText: '',
    playerTranscript: '',
    isAiSpeaking: false,
    error: null,
    summary: null,
    endSession: vi.fn(),
    requestClosing: closingControl.requestClosing,
  }),
}))

// --- Helpers -------------------------------------------------------------------

const DAILY_MODULE_TESTIDS = [
  'mock-wire-complete',
  'mock-dial-complete',
  'mock-button-complete',
  'mock-keypad-complete',
]

async function completeModules(testIds: string[]) {
  for (const testId of testIds) {
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument(), { timeout: 3000 })
    fireEvent.click(screen.getByTestId(testId))
  }
}

// --- Tests ---------------------------------------------------------------------

describe('GamePage closing-recap gating', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(loadManual).mockResolvedValue(yaml.load(practiceYamlRaw) as Manual)
    closingControl.requestClosing.mockReset()
    closingControl.setupPending()
    recapLog.record.mockReset()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('gates navigation on requestClosing — heading appears only after the promise resolves', async () => {
    render(
      <MemoryRouter initialEntries={['/bombsquad/run?mode=daily&partner=platform']}>
        <App />
      </MemoryRouter>
    )

    // Drive all 4 daily modules to completion.
    await completeModules(DAILY_MODULE_TESTIDS)

    // The RESULT effect should have called requestClosing with the DEFUSED
    // outcome (outcome-aware recap register), and recorded the run for the
    // beat-3 dedup. Navigation is blocked while the promise is pending.
    await waitFor(() => expect(closingControl.requestClosing).toHaveBeenCalled(), {
      timeout: 3000,
    })
    expect(closingControl.requestClosing).toHaveBeenCalledWith('defused')
    expect(recapLog.record).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: /拆弹成功/ })).toBeNull()

    // Resolve the recap — the .then(doNavigate) handler fires.
    closingControl.resolveClosing()

    await waitFor(
      () => expect(screen.getByRole('heading', { name: /拆弹成功/ })).toBeInTheDocument(),
      { timeout: 3000 }
    )
  }, 15000)

  it('fallback: navigates even when requestClosing rejects (error-recovery, same path as timeout)', async () => {
    // Rejection exercises the `.then(doNavigate, doNavigate)` error handler —
    // the same `doNavigate` function that the 8000ms timeout sentinel calls.
    // Testing rejection is structurally equivalent to testing the timeout but
    // avoids fake-timer complexity.
    render(
      <MemoryRouter initialEntries={['/bombsquad/run?mode=daily&partner=platform']}>
        <App />
      </MemoryRouter>
    )

    await completeModules(DAILY_MODULE_TESTIDS)

    await waitFor(() => expect(closingControl.requestClosing).toHaveBeenCalled(), {
      timeout: 3000,
    })

    // Simulate a WS drop mid-recap.
    closingControl.rejectClosing(new Error('WebSocket closed before recap finished'))

    await waitFor(
      () => expect(screen.getByRole('heading', { name: /拆弹成功/ })).toBeInTheDocument(),
      { timeout: 3000 }
    )
  }, 15000)
})
