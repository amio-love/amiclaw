import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import DailyChecklist from './DailyChecklist'
import { __resetCompanionStore } from '@/hooks/useCompanion'

/**
 * DailyChecklist copy contracts:
 *  - F3: a completed item reads「完成于 HH:MM」(the local wall-clock completion
 *    time, a point in time), never「已完成 · HH:MM」that read as a game 用时
 *    next to the result page / /me duration display (formatMs).
 *  - F4 / rc §3: the default state is ONE emotional fact; the operational
 *    caveats (longest streak / UTC reset / the anonymous device boundary)
 *    relocate behind the ⓘ Disclosure, never deleted. The「匿名状态只代表这台
 *    设备」caveat still belongs to device (anonymous) scope only.
 */

// DailyChecklist reads the shared companion store (enabled=false — no fetch).
// Reset it between cases so a stray cached companion can't flavor the streak
// line unexpectedly.
beforeEach(() => __resetCompanionStore())

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

describe('DailyChecklist — default emotional fact (rc §3)', () => {
  it('leads with the neutral emotional fact when there is no companion', () => {
    render(<DailyChecklist profile={profile()} scope="device" />)
    // current_days = 3, no companion loaded → neutral phrasing, not a caveat.
    expect(screen.getByText('连续第 3 天，今天也来了')).toBeInTheDocument()
    // The operational caveats are NOT on the default surface — they sit behind
    // the ⓘ (collapsed by default).
    expect(screen.queryByText(/匿名状态只代表这台设备/)).not.toBeInTheDocument()
    expect(screen.queryByText(/最长 5 天/)).not.toBeInTheDocument()
  })
})

describe('DailyChecklist — relocated caveats behind the ⓘ (F4 / rc §3)', () => {
  it('reveals the 匿名状态 caveat in device scope when the ⓘ is opened', () => {
    render(<DailyChecklist profile={profile()} scope="device" />)
    fireEvent.click(screen.getByRole('button', { name: '连续打卡说明' }))
    expect(screen.getByText(/最长 5 天/)).toBeInTheDocument()
    expect(screen.getByText(/匿名状态只代表这台设备/)).toBeInTheDocument()
  })

  it('omits the 匿名状态 caveat in account scope even inside the ⓘ', () => {
    render(<DailyChecklist profile={profile()} scope="account" />)
    fireEvent.click(screen.getByRole('button', { name: '连续打卡说明' }))
    // The longest-streak line still renders inside the disclosure...
    expect(screen.getByText(/最长 5 天/)).toBeInTheDocument()
    // ...but the anonymous-device boundary must not leak into the account view.
    expect(screen.queryByText(/匿名状态只代表这台设备/)).not.toBeInTheDocument()
  })
})
