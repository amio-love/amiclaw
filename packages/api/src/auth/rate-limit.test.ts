import { describe, expect, it } from 'vitest'
import { FakeKV } from './fake-kv'
import { checkEmailSendLimit, checkVerifyGlobalLimit } from './rate-limit'
import { EMAIL_SEND_LIMIT, VERIFY_GLOBAL_LIMIT } from './config'

describe('rate limit (invariant ③)', () => {
  it('allows up to the per-email cap then blocks', async () => {
    const kv = new FakeKV()
    const email = 'player@example.com'
    for (let i = 0; i < EMAIL_SEND_LIMIT; i++) {
      expect(await checkEmailSendLimit(kv.asKV(), email)).toBe(true)
    }
    // One past the cap is rejected.
    expect(await checkEmailSendLimit(kv.asKV(), email)).toBe(false)
  })

  it('counts per-email independently', async () => {
    const kv = new FakeKV()
    for (let i = 0; i < EMAIL_SEND_LIMIT; i++) {
      await checkEmailSendLimit(kv.asKV(), 'a@example.com')
    }
    // A different email starts fresh.
    expect(await checkEmailSendLimit(kv.asKV(), 'b@example.com')).toBe(true)
  })

  it('enforces a global verify cap', async () => {
    const kv = new FakeKV()
    for (let i = 0; i < VERIFY_GLOBAL_LIMIT; i++) {
      expect(await checkVerifyGlobalLimit(kv.asKV())).toBe(true)
    }
    expect(await checkVerifyGlobalLimit(kv.asKV())).toBe(false)
  })
})
