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
import { render, screen, fireEvent } from '@testing-library/react'
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

import ResultPage from './ResultPage'
import { GameProvider, type GameState } from '@/store/game-context'

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
