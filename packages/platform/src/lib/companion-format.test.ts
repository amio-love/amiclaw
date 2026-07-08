/**
 * `daysTogether` tests — companion day-age must derive from CALENDAR product
 * days (UTC dates, rolling over at 08:00 Beijing), not elapsed 24h periods.
 *
 * Regression for prod-verify F-B3: a companion created late at night showed
 * "今天认识你" a full calendar day too long because the old formula floored
 * (now - created) / 86_400_000. The fix keys off the product-day difference,
 * so the day-age flips the morning after creation, at the 08:00 Beijing / UTC
 * midnight boundary.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysTogether } from './companion-format'

// The report's real account: 伙伴「阿澈」created 2026-07-06T15:48:54Z
// (== 07-06 23:48 Beijing).
const CREATED_LATE_NIGHT = '2026-07-06T15:48:54.396Z'

afterEach(() => {
  vi.useRealTimers()
})

function at(iso: string): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe('daysTogether — product-day derivation', () => {
  it('is 0 on the creation product day (card shows 今天认识你)', () => {
    at('2026-07-06T15:55:00Z') // minutes after creation, same UTC date
    expect(daysTogether(CREATED_LATE_NIGHT)).toBe(0)
  })

  it('flips to 1 the next morning at the 08:00 Beijing boundary (the F-B3 fix)', () => {
    at('2026-07-07T00:01:00Z') // 07-07 08:01 Beijing — the old 24h-floor still read 0
    expect(daysTogether(CREATED_LATE_NIGHT)).toBe(1)
  })

  it('is still 0 at 07:59 Beijing, before the product-day rollover', () => {
    at('2026-07-06T23:59:00Z') // 07-07 07:59 Beijing — same product day as creation
    expect(daysTogether(CREATED_LATE_NIGHT)).toBe(0)
  })

  it('reads 2 on the third calendar product day, matching user intuition ("认识了 2 天")', () => {
    at('2026-07-08T06:00:00Z') // 07-08 afternoon Beijing; creation product day 07-06
    expect(daysTogether(CREATED_LATE_NIGHT)).toBe(2)
  })

  it('never goes negative for a future timestamp, and returns 0 for garbage', () => {
    at('2026-07-06T00:00:00Z')
    expect(daysTogether('2026-07-10T00:00:00Z')).toBe(0)
    expect(daysTogether('not-a-date')).toBe(0)
  })
})
