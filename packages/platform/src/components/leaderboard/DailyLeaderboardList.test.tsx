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

describe('LeaderboardRows — same-nickname disambiguation (F2)', () => {
  const DUP_ENTRIES: LeaderboardEntry[] = [
    { rank: 1, nickname: '审计员W4', time_ms: 36_000, attempt_number: 1, ai_tool: 'claude' },
    { rank: 2, nickname: '审计员W4', time_ms: 36_000, attempt_number: 1, ai_tool: 'claude' },
    { rank: 3, nickname: '独一无二', time_ms: 90_000, attempt_number: 1 },
  ]

  it('numbers each colliding nickname so distinct devices read as distinct players', () => {
    render(<LeaderboardRows entries={DUP_ENTRIES} />)
    // Both colliding rows are marked, in order.
    expect(screen.getByText(/· 同名 1/)).toBeInTheDocument()
    expect(screen.getByText(/· 同名 2/)).toBeInTheDocument()
    // The rows are still both present (never merged) and still say the name.
    expect(screen.getAllByText(/审计员W4/)).toHaveLength(2)
  })

  it('leaves a unique nickname unmarked', () => {
    render(<LeaderboardRows entries={DUP_ENTRIES} />)
    const unique = screen.getByText('独一无二')
    expect(unique.textContent).toBe('独一无二')
    expect(screen.queryByText(/· 同名 3/)).not.toBeInTheDocument()
  })
})
