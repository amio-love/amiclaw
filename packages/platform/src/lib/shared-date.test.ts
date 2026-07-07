/**
 * Product-day helper tests (`@shared/date`).
 *
 * The product day is the UTC date: all daily surfaces (daily challenge,
 * leaderboard, checklist, Oracle sign) roll over together at UTC midnight,
 * which is 08:00 in Beijing. These tests pin the boundary behavior and the
 * localized rollover-time rendering behind the user-facing reset hint.
 */
import { describe, expect, it } from 'vitest'
import {
  getDailyResetHint,
  getLocalRolloverTime,
  getTodayString,
  toChineseDateString,
} from '@shared/date'

describe('getTodayString — UTC product day', () => {
  it('07:59 Beijing still belongs to the previous product day (23:59 UTC)', () => {
    // 2026-07-07 07:59 Asia/Shanghai == 2026-07-06T23:59Z
    expect(getTodayString(new Date('2026-07-06T23:59:00Z'))).toBe('2026-07-06')
  })

  it('08:01 Beijing belongs to the new product day (00:01 UTC)', () => {
    // 2026-07-07 08:01 Asia/Shanghai == 2026-07-07T00:01Z
    expect(getTodayString(new Date('2026-07-07T00:01:00Z'))).toBe('2026-07-07')
  })

  it('rolls over exactly at UTC midnight', () => {
    expect(getTodayString(new Date('2026-07-06T23:59:59.999Z'))).toBe('2026-07-06')
    expect(getTodayString(new Date('2026-07-07T00:00:00.000Z'))).toBe('2026-07-07')
  })
})

describe('getLocalRolloverTime', () => {
  const now = new Date('2026-07-06T12:00:00Z')

  it('renders the UTC-midnight rollover as 08:00 in Asia/Shanghai', () => {
    expect(getLocalRolloverTime(now, 'Asia/Shanghai')).toBe('08:00')
  })

  it('renders 00:00 in UTC itself', () => {
    expect(getLocalRolloverTime(now, 'UTC')).toBe('00:00')
  })

  it('handles non-hour offsets (Asia/Kathmandu, UTC+05:45)', () => {
    expect(getLocalRolloverTime(now, 'Asia/Kathmandu')).toBe('05:45')
  })
})

describe('getDailyResetHint', () => {
  it('states the UTC rule with the localized rollover time', () => {
    expect(getDailyResetHint(new Date('2026-07-06T12:00:00Z'), 'Asia/Shanghai')).toBe(
      '每日内容按 UTC 日期刷新 · 本地时间每天 08:00'
    )
  })
})

describe('toChineseDateString', () => {
  it('renders a product-day string in the Chinese date form', () => {
    expect(toChineseDateString('2026-07-06')).toBe('2026 年 7 月 6 日')
  })
})
