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
  getProductDaysEndingAt,
  getRecentProductDays,
  getTodayString,
  productDayDelta,
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

describe('getProductDaysEndingAt — the single day-window derivation', () => {
  it('walks back from a product-day string, newest first, across month boundaries', () => {
    expect(getProductDaysEndingAt('2026-07-01', 3)).toEqual([
      '2026-07-01',
      '2026-06-30',
      '2026-06-29',
    ])
  })
})

describe('getRecentProductDays', () => {
  it('walks back from the UTC product day, today first', () => {
    expect(getRecentProductDays(3, new Date('2026-07-01T00:30:00Z'))).toEqual([
      '2026-07-01',
      '2026-06-30',
      '2026-06-29',
    ])
  })

  it('agrees with getTodayString on the first entry at a day boundary', () => {
    const now = new Date('2026-07-06T23:59:59Z')
    expect(getRecentProductDays(1, now)[0]).toBe(getTodayString(now))
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

describe('productDayDelta — companion day-age from CALENDAR product days', () => {
  // The report's F-B3 scenario: a companion created late at night (23:48
  // Beijing on 07-06 == 15:48Z) must age by CALENDAR product days, not by
  // elapsed 24h periods — the old floor((now-created)/86400000) lagged a day.
  const createdLateNight = '2026-07-06T15:48:54.396Z'

  it('is 0 on the creation product day (still "今天认识")', () => {
    // 07-06 23:50 Beijing == 15:50Z — same UTC date as creation.
    expect(productDayDelta(createdLateNight, new Date('2026-07-06T15:50:00Z'))).toBe(0)
  })

  it('is 1 the very next morning — the moment the 08:00 Beijing boundary is crossed', () => {
    // 07-07 08:01 Beijing == 07-07T00:01Z — the first product-day rollover.
    // The old 24h-floor formula would still read 0 here (only ~8h elapsed).
    expect(productDayDelta(createdLateNight, new Date('2026-07-07T00:01:00Z'))).toBe(1)
  })

  it('still belongs to day 0 at 07:59 Beijing (before the boundary)', () => {
    // 07-07 07:59 Beijing == 07-06T23:59Z — same product day as creation.
    expect(productDayDelta(createdLateNight, new Date('2026-07-06T23:59:00Z'))).toBe(0)
  })

  it('is 2 on the third calendar product day — matching the report ("认识了 2 天")', () => {
    // 07-08 afternoon Beijing; creation product day 07-06 → delta 2.
    expect(productDayDelta(createdLateNight, new Date('2026-07-08T06:00:00Z'))).toBe(2)
  })

  it('counts product-day boundaries, not full 24h periods, across midnight creation', () => {
    // Created 00:30 Beijing (07-06T16:30Z); one minute past the next boundary.
    expect(productDayDelta('2026-07-06T16:30:00Z', new Date('2026-07-07T00:01:00Z'))).toBe(1)
  })

  it('is negative for a future creation and NaN for an unparseable timestamp', () => {
    expect(productDayDelta('2026-07-10T00:00:00Z', new Date('2026-07-08T00:00:00Z'))).toBe(-2)
    expect(Number.isNaN(productDayDelta('not-a-date'))).toBe(true)
  })
})
