import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDailyCountdown } from './useDailyCountdown'

describe('useDailyCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('decomposes the time left until the next UTC midnight into a padded tuple', () => {
    // 08:37:21 UTC leaves 15:22:39 until 2026-05-22T00:00:00Z.
    vi.setSystemTime(new Date('2026-05-21T08:37:21Z'))
    const { result } = renderHook(() => useDailyCountdown())
    expect(result.current).toEqual(['15', '22', '39'])
  })

  it('recomputes the tuple after each elapsed second', () => {
    vi.setSystemTime(new Date('2026-05-21T08:37:21Z'))
    const { result } = renderHook(() => useDailyCountdown())
    expect(result.current).toEqual(['15', '22', '39'])

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toEqual(['15', '22', '38'])
  })

  it('zero-pads every field when only one second remains before the reset', () => {
    vi.setSystemTime(new Date('2026-05-21T23:59:59Z'))
    const { result } = renderHook(() => useDailyCountdown())
    expect(result.current).toEqual(['00', '00', '01'])
  })
})
