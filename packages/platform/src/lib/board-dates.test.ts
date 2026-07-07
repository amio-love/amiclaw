/**
 * Date-switcher model tests (`@/lib/board-dates`).
 *
 * The leaderboard date switcher (LEADERBOARD_RETENTION_DAYS window) and the
 * /me history view (7-day window) both walk recent UTC product days through
 * getBoardDays / boardDayLabel. These tests pin the day derivation (same
 * source as getTodayString, so the window crosses month boundaries correctly)
 * and the compact Chinese labels (今天 / 昨天 / 前天 / M 月 D 日).
 */
import { describe, expect, it } from 'vitest'
import { boardDayLabel, getBoardDays } from '@/lib/board-dates'
import { LEADERBOARD_RETENTION_DAYS } from '@shared/leaderboard-types'

describe('getBoardDays', () => {
  it('returns the requested product days, today first, across month boundaries', () => {
    const days = getBoardDays(7, new Date('2026-07-06T12:00:00Z'))
    expect(days.map((day) => day.date)).toEqual([
      '2026-07-06',
      '2026-07-05',
      '2026-07-04',
      '2026-07-03',
      '2026-07-02',
      '2026-07-01',
      '2026-06-30',
    ])
  })

  it('derives the day set from the UTC product day, not the local date', () => {
    // 2026-07-07 07:59 Beijing == 2026-07-06T23:59Z — still product day 07-06.
    const days = getBoardDays(2, new Date('2026-07-06T23:59:00Z'))
    expect(days[0].date).toBe('2026-07-06')
    expect(days[1].date).toBe('2026-07-05')
  })

  it('labels the window 今天 / 昨天 / 前天 then M 月 D 日', () => {
    const days = getBoardDays(7, new Date('2026-07-06T12:00:00Z'))
    expect(days.map((day) => day.label)).toEqual([
      '今天',
      '昨天',
      '前天',
      '7 月 3 日',
      '7 月 2 日',
      '7 月 1 日',
      '6 月 30 日',
    ])
  })

  it('covers the leaderboard retention window with plain-word labels', () => {
    // The leaderboard switcher passes LEADERBOARD_RETENTION_DAYS (2), so its
    // whole window is 今天/昨天 — no expired day is ever navigable.
    const days = getBoardDays(LEADERBOARD_RETENTION_DAYS, new Date('2026-07-06T12:00:00Z'))
    expect(days.map((day) => day.label)).toEqual(['今天', '昨天'])
  })
})

describe('boardDayLabel', () => {
  it('strips leading zeros from the short date form', () => {
    expect(boardDayLabel('2026-01-05', 3)).toBe('1 月 5 日')
  })
})
