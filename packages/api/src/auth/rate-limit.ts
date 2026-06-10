/**
 * KV-counter rate limits (invariant ③).
 *
 * Two independent limits:
 *   - per-email magic-link send cap (`ratelimit:email:<email>`)
 *   - global verify-endpoint cap (`ratelimit:verify:global`)
 *
 * KV has no atomic increment. We read-modify-write a `{ count, window_start }`
 * record and re-arm the TTL each window. This is best-effort under concurrent
 * writes (a lost update can let a couple of extra requests through) — adequate
 * for abuse throttling, where exactness is not required. A hard, exact limit
 * would need Durable Objects, which is explicitly out of scope this round.
 */

import { rateLimitEmailKey, rateLimitVerifyGlobalKey } from './kv-keys'
import {
  EMAIL_SEND_LIMIT,
  EMAIL_SEND_WINDOW_SECONDS,
  VERIFY_GLOBAL_LIMIT,
  VERIFY_GLOBAL_WINDOW_SECONDS,
} from './config'

interface CounterRecord {
  count: number
  window_start: number // epoch ms
}

/**
 * Increment a counter and report whether the request is allowed (count was
 * within `limit` BEFORE this increment). When the stored window has expired we
 * start a fresh window at count 1.
 */
async function hitCounter(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  const existing = (await kv.get(key, 'json')) as CounterRecord | null

  let record: CounterRecord
  if (!existing || now - existing.window_start >= windowMs) {
    record = { count: 1, window_start: now }
  } else {
    record = { count: existing.count + 1, window_start: existing.window_start }
  }

  // Re-arm TTL to cover the remainder of the current window (min 1s).
  const elapsed = now - record.window_start
  const remainingSeconds = Math.max(1, Math.ceil((windowMs - elapsed) / 1000))
  await kv.put(key, JSON.stringify(record), { expirationTtl: remainingSeconds })

  return record.count <= limit
}

/** Returns true if this email is still allowed to trigger a send. */
export function checkEmailSendLimit(kv: KVNamespace, email: string): Promise<boolean> {
  return hitCounter(kv, rateLimitEmailKey(email), EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_SECONDS)
}

/** Returns true if the verify endpoint is still under its global cap. */
export function checkVerifyGlobalLimit(kv: KVNamespace): Promise<boolean> {
  return hitCounter(
    kv,
    rateLimitVerifyGlobalKey(),
    VERIFY_GLOBAL_LIMIT,
    VERIFY_GLOBAL_WINDOW_SECONDS
  )
}
