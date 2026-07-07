/**
 * LeaderboardRows column-semantics test.
 *
 * The composite score column renders `attempt_number` — which daily attempt
 * set the shown time. A previous header labeled it 失误 (mistakes), so a
 * flawless first-try win read as "1 mistake". Guard the honest labeling:
 * header says 尝试 and each cell renders 第 N 次.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { LeaderboardEntry } from '@shared/leaderboard-types'
import { LeaderboardRows } from './DailyLeaderboardList'

const ENTRIES: LeaderboardEntry[] = [
  { rank: 1, nickname: '小明', time_ms: 130_000, attempt_number: 1, ai_tool: 'claude' },
  { rank: 2, nickname: '小红', time_ms: 145_000, attempt_number: 3 },
]

describe('LeaderboardRows — attempt column semantics', () => {
  it('labels the composite column 用时 · 尝试, not 失误', () => {
    render(<LeaderboardRows entries={ENTRIES} />)
    expect(screen.getByRole('columnheader', { name: '用时 · 尝试' })).toBeInTheDocument()
    expect(screen.queryByText(/失误/)).not.toBeInTheDocument()
  })

  it('renders each attempt value as 第 N 次', () => {
    render(<LeaderboardRows entries={ENTRIES} />)
    expect(screen.getByText(/02:10 · 第 1 次/)).toBeInTheDocument()
    expect(screen.getByText(/02:25 · 第 3 次/)).toBeInTheDocument()
  })
})
