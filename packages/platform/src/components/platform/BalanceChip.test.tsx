/**
 * BalanceChip tests.
 *
 * The chip reads `GET /api/companion/assets` (via useBalance → fetchAssets).
 * Each test stubs global.fetch to return either an assets body or a 401, then
 * awaits the async resolution. The chip renders the balance pill only once a
 * numeric balance resolves; a 401 / failure renders nothing (never a broken
 * pill).
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CompanionAssetsResponse } from '@shared/companion-types'
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

describe('BalanceChip', () => {
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
})
