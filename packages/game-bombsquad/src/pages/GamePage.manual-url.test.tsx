/**
 * GamePage manual-URL derivation regression guard.
 *
 * A daily run launched with NO `url` query param must fetch from the YAML
 * data endpoint — `${origin}/manual/data/<UTC-today>.yaml` — rather than the
 * HTML share page (`/manual/<date>`). Fetching the HTML page caused the daily
 * challenge to always show "手册格式异常" because yaml.load(htmlText) throws
 * ManualParseError (root bug: fix-daily-manual-fetch-url).
 *
 * Also pins the UTC-0-safe date behaviour: Date.toISOString() always renders
 * in UTC/Zulu, so slice(0,10) is stable even near local midnight.
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
vi.mock('@/utils/yaml-loader', async (importOriginal) => {
  // Spread the real module so toManualDataUrl (and any future exports) stay
  // functional — only loadManual is replaced with a capture mock.
  const real = await importOriginal<typeof import('@/utils/yaml-loader')>()
  return {
    ...real,
    loadManual: loadManualMock,
  }
})

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
    // Engine must fetch the YAML data file, not the HTML share page.
    expect(calledUrl).toMatch(new RegExp(`/manual/data/${PINNED_UTC_DATE}\\.yaml$`))
    // Must NOT fetch the HTML share page (the root bug).
    expect(calledUrl).not.toMatch(new RegExp(`/manual/${PINNED_UTC_DATE}$`))
    // And it must NOT silently fall back to practice or an empty path.
    expect(calledUrl).not.toContain('/manual/practice')
  })
})
