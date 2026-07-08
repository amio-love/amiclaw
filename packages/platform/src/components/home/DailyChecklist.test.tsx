import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import DailyChecklist from './DailyChecklist'

/**
 * DailyChecklist copy contracts:
 *  - F3: a completed item reads「完成于 HH:MM」(the local wall-clock completion
 *    time, a point in time), never「已完成 · HH:MM」that read as a game 用时
 *    next to the result page / /me duration display (formatMs).
 *  - F4: the「匿名状态只代表这台设备」caveat only belongs to device (anonymous)
 *    scope; the 本账号 (signed-in) view must not leak it.
 */

function profile(overrides?: {
  bombsquadCompletedAt?: string | null
  bombsquadCompleted?: boolean
}): ArcadeProfileSummary {
  const daily_loop = {
    date: '2026-07-08',
    checklist: {
      bombsquad_daily: {
        completed: overrides?.bombsquadCompleted ?? true,
        // Honor an explicit `null` (in-key check, since `null ?? default`
        // would collapse back to the default timestamp).
        completed_at:
          overrides && 'bombsquadCompletedAt' in overrides
            ? overrides.bombsquadCompletedAt
            : '2026-07-08T20:44:00.000Z',
      },
      oracle_sign: { completed: false, completed_at: null },
    },
    streak: {
      today_completed: true,
      current_days: 3,
      longest_days: 5,
      last_active_date: '2026-07-08',
    },
  }
  return { daily_loop } as unknown as ArcadeProfileSummary
}

describe('DailyChecklist — completion time label (F3)', () => {
  it('renders a completed item as「完成于 HH:MM」, not「已完成 · HH:MM」', () => {
    render(<DailyChecklist profile={profile()} scope="device" />)
    expect(screen.getByText(/^完成于 \d{2}:\d{2}$/)).toBeInTheDocument()
    expect(screen.queryByText(/^已完成 · /)).not.toBeInTheDocument()
  })

  it('falls back to「已完成」when no completion timestamp is present', () => {
    render(<DailyChecklist profile={profile({ bombsquadCompletedAt: null })} scope="device" />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })
})

describe('DailyChecklist — anonymous caveat scope (F4)', () => {
  it('shows the 匿名状态 caveat in device scope', () => {
    render(<DailyChecklist profile={profile()} scope="device" />)
    expect(screen.getByText(/匿名状态只代表这台设备。/)).toBeInTheDocument()
  })

  it('omits the 匿名状态 caveat in account scope', () => {
    render(<DailyChecklist profile={profile()} scope="account" />)
    expect(screen.queryByText(/匿名状态只代表这台设备/)).not.toBeInTheDocument()
    // The longest-streak line still renders in the account view.
    expect(screen.getByText(/最长连续 5 天。/)).toBeInTheDocument()
  })
})
