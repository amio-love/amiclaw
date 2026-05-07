/**
 * LeaderboardPage optimistic-update integration tests.
 *
 * Covers two flows:
 *  1. Optimistic insert — after submitScore returns rank=N, the freshly-stored
 *     optimistic entry appears at position N immediately, BEFORE the server
 *     response includes it (cache lag).
 *  2. Supersede on next refresh — once the GET response itself contains the
 *     just-submitted entry (cache flipped), the optimistic copy is dropped and
 *     the server response stands alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LeaderboardPage from './LeaderboardPage'
import { fetchLeaderboard } from '@/utils/leaderboard-api'
import { saveOptimisticEntry, loadOptimisticEntry } from '@/utils/leaderboard-optimistic'
import { getTodayString } from '@/utils/date'
import type { LeaderboardEntry } from '@shared/leaderboard-types'

vi.mock('@/utils/leaderboard-api', () => ({
  fetchLeaderboard: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchLeaderboard)

const otherEntries: LeaderboardEntry[] = [
  { rank: 1, nickname: 'Alpha', time_ms: 80000, attempt_number: 1 },
  { rank: 2, nickname: 'Beta', time_ms: 110000, attempt_number: 1 },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <LeaderboardPage />
    </MemoryRouter>
  )
}

describe('LeaderboardPage optimistic flow', () => {
  beforeEach(() => {
    sessionStorage.clear()
    mockedFetch.mockReset()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('shows optimistic entry at position rank=2 when GET returns lagged data', async () => {
    // Simulate a fresh POST: optimistic entry stored under today's date with
    // rank=2 returned by the API.
    const today = getTodayString()
    saveOptimisticEntry(today, {
      rank: 2,
      nickname: 'Anonymous',
      time_ms: 91234,
      attempt_number: 3,
      ai_tool: 'claude',
    })

    // GET returns the cached (pre-submission) leaderboard — optimistic entry
    // is NOT yet in the server response.
    mockedFetch.mockResolvedValueOnce({ date: today, entries: otherEntries })

    renderPage()

    // Optimistic seed renders the new row immediately, even before the GET
    // resolves (the initial useState callback reads sessionStorage).
    expect(screen.getByText('Anonymous')).toBeInTheDocument()

    // After GET resolves, the merged list shows: Alpha (1), Anonymous (2 — optimistic),
    // Beta (was 2, shifted to 3).
    await waitFor(() => {
      const rows = screen.getAllByRole('row')
      // 1 thead row + 3 body rows
      expect(rows).toHaveLength(4)
    })

    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows[0]).toHaveTextContent('Alpha')
    expect(bodyRows[1]).toHaveTextContent('Anonymous')
    expect(bodyRows[1]).toHaveAttribute('data-just-submitted', 'true')
    expect(bodyRows[2]).toHaveTextContent('Beta')

    // Sanity: the optimistic row sits at position 2 in the rank column.
    expect(bodyRows[1].textContent).toMatch(/#2/)
  })

  it('drops the optimistic entry once the GET response includes it', async () => {
    const today = getTodayString()
    saveOptimisticEntry(today, {
      rank: 2,
      nickname: 'Anonymous',
      time_ms: 91234,
      attempt_number: 3,
    })

    // Cache has flipped: GET now contains the authoritative row matching the
    // optimistic one (same nickname + time_ms + attempt_number).
    const authoritativeEntries: LeaderboardEntry[] = [
      { rank: 1, nickname: 'Alpha', time_ms: 80000, attempt_number: 1 },
      { rank: 2, nickname: 'Anonymous', time_ms: 91234, attempt_number: 3 },
      { rank: 3, nickname: 'Beta', time_ms: 110000, attempt_number: 1 },
    ]
    mockedFetch.mockResolvedValueOnce({ date: today, entries: authoritativeEntries })

    renderPage()

    await waitFor(() => {
      const rows = screen.getAllByRole('row')
      expect(rows).toHaveLength(4) // 1 thead + 3 body
    })

    const bodyRows = screen.getAllByRole('row').slice(1)
    // No row should be flagged optimistic — the server response is authoritative.
    bodyRows.forEach((row) => {
      expect(row).not.toHaveAttribute('data-just-submitted')
    })

    // sessionStorage is cleaned up so a subsequent visit doesn't re-apply it.
    expect(loadOptimisticEntry(today)).toBeNull()

    // No duplicate — exactly one Anonymous row.
    expect(screen.getAllByText('Anonymous')).toHaveLength(1)
  })

  it('renders just the GET response when no optimistic entry is set', async () => {
    const today = getTodayString()
    mockedFetch.mockResolvedValueOnce({ date: today, entries: otherEntries })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })
    expect(screen.queryByText('Anonymous')).not.toBeInTheDocument()
    const bodyRows = screen.getAllByRole('row').slice(1)
    bodyRows.forEach((row) => {
      expect(row).not.toHaveAttribute('data-just-submitted')
    })
  })
})
