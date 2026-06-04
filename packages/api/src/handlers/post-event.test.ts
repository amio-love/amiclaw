import { describe, expect, it, vi } from 'vitest'
import { handlePostEvent } from './post-event'

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

interface PutCall {
  key: string
  value: string
  options?: { expirationTtl?: number }
}

function makeKv(initialStore: Record<string, unknown> = {}): {
  kv: KVNamespace
  puts: PutCall[]
} {
  const store: Record<string, unknown> = { ...initialStore }
  const puts: PutCall[] = []

  const get = async (key: string, _type?: string): Promise<unknown> => {
    if (!(key in store)) return null
    return store[key]
  }

  const put = async (
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void> => {
    puts.push({ key, value, options })
    try {
      store[key] = JSON.parse(value) as unknown
    } catch {
      store[key] = value
    }
  }

  return { kv: { get, put } as unknown as KVNamespace, puts }
}

function makeRequest(payload: Record<string, unknown>): Request {
  return new Request('https://claw.amio.fans/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

describe('handlePostEvent — KV TTL', () => {
  it('writes the counter key with expirationTtl = 30 days (2026-05-18 dashboard requirement)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-18T10:00:00.000Z'))
      const { kv, puts } = makeKv()
      const req = makeRequest({
        event: 'game_start',
        timestamp: '2026-05-18T09:59:00.000Z',
        device_id: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
      })
      const res = await handlePostEvent(req, kv)
      expect(res.status).toBe(200)

      const counterPut = puts.find((p) => p.key === 'events:2026-05-18:game_start')
      expect(counterPut).toBeDefined()
      expect(counterPut?.options?.expirationTtl).toBe(THIRTY_DAYS_SECONDS)

      const uniquePut = puts.find((p) => p.key === 'events:2026-05-18:unique_starts')
      expect(uniquePut).toBeDefined()
      expect(uniquePut?.options?.expirationTtl).toBe(THIRTY_DAYS_SECONDS)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('handlePostEvent — game-failed telemetry counters', () => {
  it('writes a plain counter for the two game-failed events and creates no unique-device set', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-21T10:00:00.000Z'))
      for (const event of ['game_failed_strikeout', 'game_ended_timeout'] as const) {
        const { kv, puts } = makeKv()
        const req = makeRequest({
          event,
          timestamp: '2026-05-21T09:59:00.000Z',
          device_id: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
        })
        const res = await handlePostEvent(req, kv)
        expect(res.status).toBe(200)

        // Ingestion is event-name-agnostic for counters — the failure events
        // get the same `events:{date}:{name}` counter as any other event.
        const counterPut = puts.find((p) => p.key === `events:2026-05-21:${event}`)
        expect(counterPut).toBeDefined()
        expect(counterPut?.value).toBe(JSON.stringify({ count: 1 }))

        // Only game_start / game_complete maintain unique-device sets; the
        // failure events must never produce a `unique_*` key.
        expect(puts.some((p) => p.key.includes(':unique_'))).toBe(false)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('handlePostEvent — survey_submit persistence', () => {
  it('increments the counter AND persists the answers to a per-device key with 30d TTL', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-22T10:00:00.000Z'))
      const { kv, puts } = makeKv()
      const deviceId = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'
      const surveyData = {
        ai_tool: 'claude',
        fun: 5,
        difficulty: 'just-right',
        ai_issue: 'voice cut out once near the end',
      }
      const req = makeRequest({
        event: 'survey_submit',
        timestamp: '2026-05-22T09:59:00.000Z',
        device_id: deviceId,
        data: surveyData,
      })
      const res = await handlePostEvent(req, kv)
      expect(res.status).toBe(200)

      // The counter still behaves like any other event — `events:{date}:{event}` +1.
      const counterPut = puts.find((p) => p.key === 'events:2026-05-22:survey_submit')
      expect(counterPut).toBeDefined()
      expect(counterPut?.value).toBe(JSON.stringify({ count: 1 }))
      expect(counterPut?.options?.expirationTtl).toBe(THIRTY_DAYS_SECONDS)

      // IN ADDITION, the full answer payload is persisted to the per-device
      // survey key with the same 30-day TTL.
      const surveyPut = puts.find((p) => p.key === `events:2026-05-22:survey:${deviceId}`)
      expect(surveyPut).toBeDefined()
      expect(surveyPut?.value).toBe(JSON.stringify(surveyData))
      expect(surveyPut?.options?.expirationTtl).toBe(THIRTY_DAYS_SECONDS)

      // survey_submit must never produce a unique-device set.
      expect(puts.some((p) => p.key.includes(':unique_'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes no survey key for non-survey events', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-22T10:00:00.000Z'))
      const { kv, puts } = makeKv()
      const req = makeRequest({
        event: 'game_complete',
        timestamp: '2026-05-22T09:59:00.000Z',
        device_id: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
      })
      const res = await handlePostEvent(req, kv)
      expect(res.status).toBe(200)
      expect(puts.some((p) => p.key.includes(':survey:'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
