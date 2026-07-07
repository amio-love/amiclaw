/**
 * LeaderboardPage optimistic-update + date-navigation integration tests.
 *
 * Covers three flows:
 *  1. Optimistic insert — after submitScore returns rank=N, the freshly-stored
 *     optimistic entry appears at position N immediately, BEFORE the server
 *     response includes it (cache lag).
 *  2. Supersede on next refresh — once the GET response itself contains the
 *     just-submitted entry (cache flipped), the optimistic copy is dropped and
 *     the server response stands alone.
 *  3. Date navigation — the daily board's compact switcher walks exactly the
 *     LEADERBOARD_RETENTION_DAYS the KV storage retains (today + yesterday):
 *     前一天 fetches yesterday's board, an empty retained day shows the honest
 *     无人上榜 copy, both bounds disable their arrow, and the retention
 *     boundary is stated under the board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LeaderboardPage from './LeaderboardPage'
import { fetchLeaderboard } from '@shared/leaderboard-api'
import { fetchArcadeStreakLeaderboard } from '@amiclaw/arcade-profile/api-client'
import { saveOptimisticEntry, loadOptimisticEntry } from '@shared/leaderboard-optimistic'
import { getTodayString } from '@shared/date'
import { LEADERBOARD_RETENTION_DAYS, type LeaderboardEntry } from '@shared/leaderboard-types'

vi.mock('@shared/leaderboard-api', () => ({
  fetchLeaderboard: vi.fn(),
}))

vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  fetchArcadeStreakLeaderboard: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchLeaderboard)
const mockedStreakFetch = vi.mocked(fetchArcadeStreakLeaderboard)

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
    mockedStreakFetch.mockReset()
    mockedStreakFetch.mockResolvedValue({
      kind: 'ok',
      board: { date: getTodayString(), entries: [] },
    })
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
      ai_model: 'Sonnet 4.5',
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
      // 1 header row + 3 body rows
      expect(rows).toHaveLength(4)
    })

    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows[0]).toHaveTextContent('Alpha')
    expect(bodyRows[1]).toHaveTextContent('Anonymous')
    expect(bodyRows[1]).toHaveTextContent('Claude · Sonnet 4.5')
    expect(bodyRows[1]).toHaveAttribute('data-just-submitted', 'true')
    expect(bodyRows[2]).toHaveTextContent('Beta')

    // Sanity: the optimistic row sits at position 2 in the rank column
    // (Atlas list renders the rank 3-padded — `#002`).
    expect(bodyRows[1].textContent).toMatch(/#0*2/)
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
      expect(rows).toHaveLength(4) // 1 header + 3 body
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

  it('renders AI metadata when present and keeps legacy rows readable', async () => {
    const today = getTodayString()
    mockedFetch.mockResolvedValueOnce({
      date: today,
      entries: [
        { rank: 1, nickname: '小明', time_ms: 80000, attempt_number: 1, ai_tool: 'chatgpt' },
        { rank: 2, nickname: 'Legacy', time_ms: 110000, attempt_number: 1 },
      ],
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('小明')).toBeInTheDocument()
    })
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows[0]).toHaveTextContent('ChatGPT')
    expect(bodyRows[1]).toHaveTextContent('Legacy')
    expect(bodyRows[1]).not.toHaveTextContent('ChatGPT')
  })

  it('navigates to yesterday and back with the date switcher', async () => {
    const today = getTodayString()
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    mockedFetch.mockImplementation((date?: string) =>
      Promise.resolve(
        date === today ? { date: today, entries: otherEntries } : { date: date ?? '', entries: [] }
      )
    )

    renderPage()
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())
    // Today is the newest navigable day, so 后一天 starts disabled.
    expect(screen.getByRole('button', { name: '后一天' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '前一天' }))

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(yesterday))
    // Within the retained window, an empty board honestly means nobody made
    // the board — the copy must not read like today's, nor like expired data.
    expect(await screen.findByText('这一天没有人上榜。')).toBeInTheDocument()
    expect(screen.queryByText('今日还没有成绩，来抢第一！')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '后一天' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '后一天' }))
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument())
    expect(screen.getByText('今天')).toBeInTheDocument()
  })

  it('bounds navigation to the leaderboard retention window and says so', async () => {
    const today = getTodayString()
    mockedFetch.mockImplementation((date?: string) =>
      Promise.resolve({ date: date ?? today, entries: [] })
    )

    renderPage()
    // The switcher walks exactly the days the KV retention guarantees —
    // rendering an expired day would show a false「无人上榜」.
    const back = screen.getByRole('button', { name: '前一天' })
    for (let i = 0; i < LEADERBOARD_RETENTION_DAYS - 1; i++) fireEvent.click(back)

    expect(back).toBeDisabled()
    const oldest = new Date(Date.now() - (LEADERBOARD_RETENTION_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10)
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(oldest))
    // The retention boundary is stated honestly under the board.
    expect(
      screen.getByText(
        '每日榜只保留今天和昨天，更早的日榜未保存；个人记录在「我的」页保留最近 7 天。'
      )
    ).toBeInTheDocument()
  })

  it('renders the public streak leaderboard without private identifiers', async () => {
    const today = getTodayString()
    mockedFetch.mockResolvedValueOnce({ date: today, entries: [] })
    mockedStreakFetch.mockResolvedValueOnce({
      kind: 'ok',
      board: {
        date: today,
        entries: [
          {
            rank: 1,
            public_label: 'Player 8F3A',
            current_streak_days: 5,
            longest_streak_days: 7,
            last_active_date: today,
            today: { bombsquad_defused: true, oracle_signed: false },
          },
        ],
      },
    })

    renderPage()

    expect(await screen.findByText('Player 8F3A')).toBeInTheDocument()
    expect(screen.getByText(/今日 BombSquad/)).toBeInTheDocument()
    expect(screen.getByText('最长 7 天')).toBeInTheDocument()
    expect(screen.queryByText(/user_/)).not.toBeInTheDocument()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })
})
