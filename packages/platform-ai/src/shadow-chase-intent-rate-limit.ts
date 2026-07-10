/**
 * Coarse per-user cost guard for Shadow Chase model intent.
 *
 * AUTH KV has no atomic increment, so concurrent requests may lose updates.
 * That limitation is acceptable for this coarse cost throttle only; this is
 * not a billing-grade quota. The limiter stays request-scoped and injected so
 * no mutable counter leaks through a reused Worker isolate.
 */

export const RATE_LIMIT_REQUESTS = 12
export const RATE_LIMIT_WINDOW_SECONDS = 60

const WINDOW_MS = RATE_LIMIT_WINDOW_SECONDS * 1_000
const KEY_PREFIX = 'ratelimit:shadow-intent:user:'

interface RateLimitState {
  count: number
  window_start: number
}

export interface IntentRateLimitResult {
  allowed: boolean
  count: number
  limit: number
}

export interface IntentRateLimiter {
  consume(userId: string, nowMs: number): Promise<IntentRateLimitResult>
}

export interface IntentRateLimitKv {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
}

function parseState(raw: string): RateLimitState {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('shadow-intent-rate-limit: invalid limiter state')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('shadow-intent-rate-limit: invalid limiter state')
  }
  const state = parsed as Record<string, unknown>
  if (
    !Number.isSafeInteger(state.count) ||
    (state.count as number) < 1 ||
    !Number.isSafeInteger(state.window_start) ||
    (state.window_start as number) < 0
  ) {
    throw new Error('shadow-intent-rate-limit: invalid limiter state')
  }
  return { count: state.count as number, window_start: state.window_start as number }
}

export class KvIntentRateLimiter implements IntentRateLimiter {
  constructor(private readonly kv: IntentRateLimitKv) {}

  async consume(userId: string, nowMs: number): Promise<IntentRateLimitResult> {
    if (!userId || !Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error('shadow-intent-rate-limit: invalid input')
    }
    const key = `${KEY_PREFIX}${userId}`
    const raw = await this.kv.get(key)
    let state: RateLimitState
    if (raw === null) {
      state = { count: 1, window_start: nowMs }
    } else {
      const current = parseState(raw)
      if (nowMs - current.window_start >= WINDOW_MS || nowMs < current.window_start) {
        state = { count: 1, window_start: nowMs }
      } else {
        state = { count: current.count + 1, window_start: current.window_start }
      }
    }

    const remainingMs = Math.max(1, state.window_start + WINDOW_MS - nowMs)
    const expirationTtl = Math.max(1, Math.ceil(remainingMs / 1_000))
    await this.kv.put(key, JSON.stringify(state), { expirationTtl })

    return {
      allowed: state.count <= RATE_LIMIT_REQUESTS,
      count: state.count,
      limit: RATE_LIMIT_REQUESTS,
    }
  }
}
