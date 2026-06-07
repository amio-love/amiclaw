/**
 * GamePage manual-URL derivation regression guard (Optional ① from the
 * fix-daily-run-missing-url-param task).
 *
 * A daily run launched with NO `url` query param must derive the manual URL
 * from the UTC current date — `${origin}/manual/<UTC-today>` — rather than
 * crashing, loading nothing, or falling back to a stale hostname. This is the
 * root mechanism the ResultPage recovery fix sits downstream of: when the
 * connect funnel forwards into /bombsquad/run?mode=daily without a `url`
 * param, the manual still resolves.
 *
 * The slice(0,10) of an ISO string is the UTC date by construction
 * (Date.prototype.toISOString always renders in UTC / Zulu), so this also
 * pins the UTC-0-safe behavior. We mock the manual loader and capture the URL
 * it is called with on a fresh (unseeded) daily mount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))

// Capture the URL the manual loader is invoked with. `loadWithCache` (internal
// to GamePage) calls `loadManual` from this module; returning a minimal manual
// lets the load path resolve without driving the full generator.
const { loadManualMock } = vi.hoisted(() => ({
  loadManualMock: vi.fn(),
}))
vi.mock('@/utils/yaml-loader', () => ({
  loadManual: loadManualMock,
  // GamePage imports these error classes for instanceof checks; provide real
  // class stubs so the module's import binding resolves.
  ManualNetworkError: class ManualNetworkError extends Error {},
  ManualNotFoundError: class ManualNotFoundError extends Error {},
  ManualParseError: class ManualParseError extends Error {},
}))

import GamePage from './GamePage'
import { GameProvider } from '@/store/game-context'

// A fixed UTC instant mid-day so the asserted `/manual/<date>` is deterministic
// — without pinning the clock the test would flake exactly at the UTC-midnight
// boundary, where `new Date().toISOString()` ticks over to the next day between
// the component's derivation and the assertion.
const PINNED_INSTANT = '2026-03-14T12:00:00.000Z'
const PINNED_UTC_DATE = '2026-03-14'

describe('GamePage manual-URL derivation', () => {
  beforeEach(() => {
    sessionStorage.clear()
    loadManualMock.mockReset()
    // Resolve to a minimal manual; a later generator throw is irrelevant —
    // we only assert the URL the loader was called with.
    loadManualMock.mockResolvedValue({} as never)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(PINNED_INSTANT))
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('daily run with no `url` param derives the manual URL from the UTC current date', async () => {
    // No sessionStorage seed → fresh run → the mount effect fires START_LOADING
    // with the derived manual URL and calls loadManual(manualUrl).
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/bombsquad/run?mode=daily']}>
          <GameProvider>
            <GamePage />
          </GameProvider>
        </MemoryRouter>
      )
    })

    expect(loadManualMock).toHaveBeenCalledTimes(1)
    const calledUrl = loadManualMock.mock.calls[0][0] as string
    // The path segment must be the pinned UTC date, regardless of origin.
    expect(calledUrl).toMatch(new RegExp(`/manual/${PINNED_UTC_DATE}$`))
    // And it must NOT silently fall back to practice or an empty path.
    expect(calledUrl).not.toContain('/manual/practice')
  })
})
