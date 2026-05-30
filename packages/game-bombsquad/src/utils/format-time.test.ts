import { describe, it, expect } from 'vitest'
import { formatMs } from '@shared/format-time'

describe('formatMs', () => {
  it('formats a whole-minute duration as MM:SS', () => {
    expect(formatMs(600_000)).toBe('10:00')
    expect(formatMs(300_000)).toBe('05:00')
  })

  it('zero-pads minutes and seconds', () => {
    expect(formatMs(5_000)).toBe('00:05')
    expect(formatMs(65_000)).toBe('01:05')
  })

  it('floors sub-second remainders', () => {
    expect(formatMs(1_999)).toBe('00:01')
  })

  it('clamps negative input to 00:00 so an overshooting countdown never goes negative', () => {
    expect(formatMs(-1)).toBe('00:00')
    expect(formatMs(-5_000)).toBe('00:00')
  })

  it('counts down monotonically as the remaining budget shrinks', () => {
    const budget = 300_000
    const displays = [0, 65_000, 180_000, 300_000].map((elapsed) =>
      formatMs(Math.max(0, budget - elapsed))
    )
    expect(displays).toEqual(['05:00', '03:55', '02:00', '00:00'])
  })
})
