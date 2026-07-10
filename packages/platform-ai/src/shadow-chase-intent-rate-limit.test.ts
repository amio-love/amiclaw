import { describe, expect, it } from 'vitest'

import {
  KvIntentRateLimiter,
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
} from './shadow-chase-intent-rate-limit'

class FakeRateLimitKv {
  readonly values = new Map<string, string>()
  readonly ttls = new Map<string, number>()
  failGet = false
  failPut = false

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('get failed')
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string, options: { expirationTtl: number }): Promise<void> {
    if (this.failPut) throw new Error('put failed')
    this.values.set(key, value)
    this.ttls.set(key, options.expirationTtl)
  }
}

describe('KvIntentRateLimiter', () => {
  it('freezes the coarse 12 requests per 60 seconds contract', () => {
    expect(RATE_LIMIT_REQUESTS).toBe(12)
    expect(RATE_LIMIT_WINDOW_SECONDS).toBe(60)
  })

  it('allows request 12, rejects request 13, and writes the exact key and remaining TTL', async () => {
    const kv = new FakeRateLimitKv()
    const limiter = new KvIntentRateLimiter(kv)
    const now = 1_000_000

    for (let count = 1; count <= RATE_LIMIT_REQUESTS; count += 1) {
      await expect(limiter.consume('user-a', now)).resolves.toEqual({
        allowed: true,
        count,
        limit: RATE_LIMIT_REQUESTS,
      })
    }

    await expect(limiter.consume('user-a', now)).resolves.toEqual({
      allowed: false,
      count: RATE_LIMIT_REQUESTS + 1,
      limit: RATE_LIMIT_REQUESTS,
    })
    const key = 'ratelimit:shadow-intent:user:user-a'
    expect(JSON.parse(kv.values.get(key) ?? '')).toEqual({
      count: RATE_LIMIT_REQUESTS + 1,
      window_start: now,
    })
    expect(kv.ttls.get(key)).toBe(RATE_LIMIT_WINDOW_SECONDS)
  })

  it('uses the remaining-window TTL and starts a fresh window at exactly 60 seconds', async () => {
    const kv = new FakeRateLimitKv()
    const limiter = new KvIntentRateLimiter(kv)
    const key = 'ratelimit:shadow-intent:user:user-a'

    await limiter.consume('user-a', 1_000)
    await limiter.consume('user-a', 31_001)
    expect(kv.ttls.get(key)).toBe(30)

    await expect(limiter.consume('user-a', 61_000)).resolves.toEqual({
      allowed: true,
      count: 1,
      limit: RATE_LIMIT_REQUESTS,
    })
    expect(JSON.parse(kv.values.get(key) ?? '')).toEqual({ count: 1, window_start: 61_000 })
    expect(kv.ttls.get(key)).toBe(60)
  })

  it('fails closed on malformed state and KV read/write failures', async () => {
    const kv = new FakeRateLimitKv()
    const limiter = new KvIntentRateLimiter(kv)
    const key = 'ratelimit:shadow-intent:user:user-a'

    kv.values.set(key, '{bad json')
    await expect(limiter.consume('user-a', 0)).rejects.toThrow(/invalid limiter state/)

    kv.values.clear()
    kv.failGet = true
    await expect(limiter.consume('user-a', 0)).rejects.toThrow('get failed')

    kv.failGet = false
    kv.failPut = true
    await expect(limiter.consume('user-a', 0)).rejects.toThrow('put failed')
  })
})
