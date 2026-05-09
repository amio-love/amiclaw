import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT_LOG_PREFIX, logEvent } from './event-log'

describe('logEvent', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  it('writes a single console.info call with the bombsquad-event prefix', () => {
    logEvent('game_start', { mode: 'practice' })

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy.mock.calls[0][0]).toBe(EVENT_LOG_PREFIX)
    expect(EVENT_LOG_PREFIX).toBe('[bombsquad-event]')
  })

  it('passes a JSON-serializable payload with event, timestamp, and extra data', () => {
    logEvent('game_start', { mode: 'daily', attemptNumber: 2, rngSeed: 12345 })

    const payload = infoSpy.mock.calls[0][1] as Record<string, unknown>

    expect(payload).toMatchObject({
      event: 'game_start',
      mode: 'daily',
      attemptNumber: 2,
      rngSeed: 12345,
    })
    expect(typeof payload.timestamp).toBe('string')
    // ISO 8601 UTC: 2026-05-06T12:34:56.789Z
    expect(payload.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)

    // Round-trips through JSON.stringify without throwing — a hard guarantee
    // that whatever we shovel into it stays serializable for later capture.
    expect(() => JSON.stringify(payload)).not.toThrow()
  })

  it('defaults the data argument to an empty object', () => {
    logEvent('manual_load_failed')

    const payload = infoSpy.mock.calls[0][1] as Record<string, unknown>
    expect(payload.event).toBe('manual_load_failed')
    expect(typeof payload.timestamp).toBe('string')
  })

  it('uses the current ISO timestamp when fake timers are active', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-06T12:34:56.000Z'))
      logEvent('game_complete', { totalTimeMs: 60000 })
      const payload = infoSpy.mock.calls[0][1] as Record<string, unknown>
      expect(payload.timestamp).toBe('2026-05-06T12:34:56.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
})
