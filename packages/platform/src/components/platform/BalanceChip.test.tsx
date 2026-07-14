/**
 * BalanceChip tests.
 *
 * The chip reads `GET /api/companion/assets` (via useBalance → fetchAssets).
 * Each test stubs global.fetch to return either an assets body or a 401, then
 * awaits the async resolution. The chip renders the balance pill only once a
 * numeric balance resolves; a 401 / failure renders nothing (never a broken
 * pill).
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import type { CompanionAssetsResponse } from '@shared/companion-types'
import { pushBalance, reloadBalance, resetBalanceStore } from '@/lib/balance-store'
import BalanceChip from './BalanceChip'

const ASSETS: CompanionAssetsResponse = {
  asset_type: 'starburst',
  balance: 12,
  entries: [
    { amount: 5, source_product: 'bombsquad', kind: 'win', earned_at: '2026-07-14T00:55:00.000Z' },
    {
      amount: -6,
      source_product: 'platform-ai',
      kind: 'session',
      earned_at: '2026-07-14T02:10:00.000Z',
    },
  ],
}

function stubAssets(status: number, body?: CompanionAssetsResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(body ? JSON.stringify(body) : null, { status })))
  )
}

/** Stub a sequence of 200 assets bodies — call N returns body N (the last body
 *  repeats). Used to model a mint read (welcome_granted true) followed by a
 *  reload that no longer re-mints. */
function stubAssetsBodies(...bodies: CompanionAssetsResponse[]) {
  let call = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const body = bodies[Math.min(call, bodies.length - 1)]
      call += 1
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
  )
}

/** Stub a raw response (any status, any body string) for the failure-mode
 *  (graceful-degradation) tests: a 500, a malformed body, a non-numeric balance. */
function stubRaw(status: number, rawBody: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(rawBody, { status })))
  )
}

/** Assert the chip rendered NOTHING even after the read would have resolved: no
 *  button ever appears within the window, and the container is empty. */
async function expectNeverRenders(container: HTMLElement) {
  await expect(screen.findByRole('button', undefined, { timeout: 400 })).rejects.toBeDefined()
  expect(container).toBeEmptyDOMElement()
}

describe('BalanceChip', () => {
  // The balance store is a module singleton shared across every subscriber, so
  // each case starts from a clean slate (else a prior test's ready value would
  // block the initial-load-failure hides below).
  beforeEach(() => {
    resetBalanceStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the authed balance and opens the ledger drawer on tap', async () => {
    stubAssets(200, ASSETS)
    render(<BalanceChip />)

    const button = await screen.findByRole('button', { name: /星芒余额 12/ })
    expect(button).toBeInTheDocument()

    await userEvent.click(button)

    // The shared Modal opens with the ledger, each row labeled by its kind.
    expect(await screen.findByText('星芒明细')).toBeInTheDocument()
    expect(screen.getByText('过关奖励')).toBeInTheDocument()
    expect(screen.getByText('语音陪伴')).toBeInTheDocument()
  })

  it('renders nothing for an anonymous (401) read', async () => {
    stubAssets(401)
    const { container } = render(<BalanceChip />)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the one-time +10 welcome beat on the minting read', async () => {
    stubAssets(200, { ...ASSETS, balance: 10, welcome_granted: true })
    render(<BalanceChip />)

    // The beat text carries the +10, so it is distinct from a ledger 见面礼 row.
    expect(await screen.findByText(/\+10.*见面礼/)).toBeInTheDocument()
  })

  it('shows the welcome beat only on the mint, not on the following read', async () => {
    stubAssetsBodies(
      { ...ASSETS, balance: 10, welcome_granted: true },
      { ...ASSETS, balance: 10, welcome_granted: false }
    )
    render(<BalanceChip />)

    const button = await screen.findByRole('button', { name: /星芒余额/ })
    expect(screen.getByText(/\+10.*见面礼/)).toBeInTheDocument()

    // Opening the ledger reloads; the grant no longer re-mints, so the beat clears.
    await userEvent.click(button)
    await waitFor(() => expect(screen.queryByText(/\+10.*见面礼/)).not.toBeInTheDocument())
  })

  it('repaints the balance when a fresh value is pushed (a reward response)', async () => {
    stubAssets(200, ASSETS)
    render(<BalanceChip />)

    // Mounts at the read-time balance (12) — the mount-once value.
    await screen.findByRole('button', { name: /星芒余额 12/ })

    // A settlement win credits +5 and the response carries the new balance; the
    // reward-drop flow pushes it into the store, so the chip repaints WITHOUT a
    // remount or a re-fetch (the mount-once staleness this fix removes).
    act(() => {
      pushBalance(17)
    })

    expect(await screen.findByRole('button', { name: /星芒余额 17/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /星芒余额 12/ })).not.toBeInTheDocument()
  })

  it('keeps the last-known balance when a refresh fails (never hides a good chip)', async () => {
    stubAssets(200, ASSETS)
    render(<BalanceChip />)

    await screen.findByRole('button', { name: /星芒余额 12/ })

    // A later refresh (e.g. the visibility refetch on return from a game) hits a
    // transient 500: the chip must hold its last-known value, not blank out. The
    // render-nothing failure path is reserved for the INITIAL empty read.
    stubRaw(500, null)
    await act(async () => {
      await reloadBalance()
    })

    expect(screen.getByRole('button', { name: /星芒余额 12/ })).toBeInTheDocument()
  })

  // --- Live-refresh wiring: the effect re-reads on the DOM events that mark a
  //     "return from a game SPA" (the mount-once staleness this fix removes).
  //     These fire the real events so the wiring itself is under test, not just
  //     the store's reloadBalance. ---

  /** Stub a call-counting 200 assets fetch so a refetch is observable. */
  function stubCountingAssets() {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(ASSETS), { status: 200 }))
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('refetches when the document becomes visible (return from a game)', async () => {
    const fetchMock = stubCountingAssets()
    render(<BalanceChip />)
    await screen.findByRole('button', { name: /星芒余额 12/ })
    expect(fetchMock).toHaveBeenCalledTimes(1) // the initial mount read

    // jsdom defaults visibilityState to 'visible'; dispatching visibilitychange
    // exercises the handler's `=== 'visible'` guard and re-reads.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(document.visibilityState).toBe('visible')
  })

  it('refetches on pageshow (bfcache restore via back/forward)', async () => {
    const fetchMock = stubCountingAssets()
    render(<BalanceChip />)
    await screen.findByRole('button', { name: /星芒余额 12/ })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT refetch while hidden — the refetch is event-gated, not a timer', async () => {
    const fetchMock = stubCountingAssets()
    render(<BalanceChip />)
    await screen.findByRole('button', { name: /星芒余额 12/ })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A visibilitychange to `hidden` (tab backgrounded) must be ignored — the
    // refetch fires only on becoming visible. This is the "no polling" guard:
    // were the hook re-reading on a blind timer, a hidden tab would still fetch;
    // gating on the visible transition proves it re-reads on the event alone.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(fetchMock).toHaveBeenCalledTimes(1) // unchanged — no refetch while hidden
    } finally {
      // Restore jsdom's default getter so later cases see 'visible'.
      delete (document as unknown as { visibilityState?: unknown }).visibilityState
    }
  })

  // --- Graceful degradation: every failure mode renders NOTHING on the INITIAL
  //     read (fetchAssets guards → store 'unavailable' → the chip is null). ---

  it('renders nothing on a server error (500)', async () => {
    stubRaw(500, null)
    const { container } = render(<BalanceChip />)
    await expectNeverRenders(container)
  })

  it('renders nothing on a malformed response body', async () => {
    stubRaw(200, 'not-json{')
    const { container } = render(<BalanceChip />)
    await expectNeverRenders(container)
  })

  it('renders nothing when the balance is not a number', async () => {
    stubRaw(200, JSON.stringify({ asset_type: 'starburst', balance: 'lots', entries: [] }))
    const { container } = render(<BalanceChip />)
    await expectNeverRenders(container)
  })
})
