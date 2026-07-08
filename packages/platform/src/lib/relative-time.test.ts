/**
 * `@shared/relative-time` tests.
 *
 * The community feed renders a live relative label from the real event time —
 * the fix for the F4 anti-pattern (a frozen 「12 分钟前」 that never advanced).
 * These pin the buckets and the past-week absolute-date fallback against a fixed
 * `now`, so the label is a pure function of (event time, current time).
 */
import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '@shared/relative-time'

const NOW = new Date('2026-07-08T12:00:00.000Z')

describe('formatRelativeTime', () => {
  it('reads 刚刚 within the last minute', () => {
    expect(formatRelativeTime('2026-07-08T11:59:30.000Z', NOW)).toBe('刚刚')
  })

  it('reads N 分钟前 within the hour', () => {
    expect(formatRelativeTime('2026-07-08T11:48:00.000Z', NOW)).toBe('12 分钟前')
  })

  it('reads N 小时前 within the day', () => {
    expect(formatRelativeTime('2026-07-08T09:00:00.000Z', NOW)).toBe('3 小时前')
  })

  it('reads N 天前 within the week', () => {
    expect(formatRelativeTime('2026-07-05T12:00:00.000Z', NOW)).toBe('3 天前')
  })

  it('falls back to an absolute M 月 D 日 past a week', () => {
    expect(formatRelativeTime('2026-06-20T12:00:00.000Z', NOW)).toBe('6 月 20 日')
  })

  it('clamps a future timestamp to 刚刚 rather than a negative age', () => {
    expect(formatRelativeTime('2026-07-08T12:05:00.000Z', NOW)).toBe('刚刚')
  })

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('')
  })
})
