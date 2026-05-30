import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub the device-fingerprint module so logEvent gets a deterministic UUID
// without touching localStorage. The stubbed value is a canonical v4 UUID.
// `vi.hoisted` lets us reference the constant from the hoisted `vi.mock`
// factory without triggering a TDZ error (vi.mock is hoisted above imports).
const { STUB_DEVICE_ID } = vi.hoisted(() => ({
  STUB_DEVICE_ID: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))
vi.mock('./device-fingerprint', () => ({
  getDeviceId: () => STUB_DEVICE_ID,
}))

import { logEvent } from './event-log'

type FetchInit = RequestInit | undefined

function parseBody(init: FetchInit): Record<string, unknown> {
  if (!init || typeof init.body !== 'string') {
    throw new Error('expected fetch body to be a JSON string')
  }
  return JSON.parse(init.body) as Record<string, unknown>
}

describe('logEvent', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs a single fetch to /api/events with the expected envelope', () => {
    logEvent('game_start', { mode: 'practice' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, FetchInit]
    expect(url).toBe('/api/events')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.['Content-Type']).toBe('application/json')
    expect(init?.keepalive).toBe(true)

    const body = parseBody(init)
    expect(body.event).toBe('game_start')
    expect(body.device_id).toBe(STUB_DEVICE_ID)
    expect(typeof body.timestamp).toBe('string')
    expect(body.data).toEqual({ mode: 'practice' })
  })

  it('serializes the full payload including extra data fields', () => {
    logEvent('game_start', { mode: 'daily', attemptNumber: 2, rngSeed: 12345 })

    const [, init] = fetchMock.mock.calls[0] as [string, FetchInit]
    const body = parseBody(init)

    expect(body).toMatchObject({
      event: 'game_start',
      device_id: STUB_DEVICE_ID,
      data: { mode: 'daily', attemptNumber: 2, rngSeed: 12345 },
    })
    expect(typeof body.timestamp).toBe('string')
    // ISO 8601 UTC: 2026-05-06T12:34:56.789Z
    expect(body.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })

  it('defaults the data argument to an empty object', () => {
    logEvent('manual_load_failed')

    const [, init] = fetchMock.mock.calls[0] as [string, FetchInit]
    const body = parseBody(init)
    expect(body.event).toBe('manual_load_failed')
    expect(body.data).toEqual({})
    expect(typeof body.timestamp).toBe('string')
  })

  it('uses the current ISO timestamp when fake timers are active', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-06T12:34:56.000Z'))
      logEvent('game_complete', { totalTimeMs: 60000 })
      const [, init] = fetchMock.mock.calls[0] as [string, FetchInit]
      const body = parseBody(init)
      expect(body.timestamp).toBe('2026-05-06T12:34:56.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('swallows network failures silently — does not throw, does not log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockReturnValue(Promise.reject(new Error('network down')))

    // Synchronous call site must not throw…
    expect(() => logEvent('game_abandon', { reason: 'tab_close' })).not.toThrow()

    // …and the rejected promise must be caught without surfacing to console.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errorSpy).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
