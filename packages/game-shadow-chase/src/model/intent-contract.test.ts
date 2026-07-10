import { describe, expect, it } from 'vitest'

import {
  INTENT_TIMEOUT_MS,
  LEASE_MAX_TICKS,
  LEASE_MIN_TICKS,
  MAX_BARK_CODEPOINTS,
  MAX_MODEL_OUTPUT_BYTES,
  MAX_REQUEST_BYTES,
  parseIntentResponse,
} from './intent-contract'

describe('model intent contract', () => {
  it('freezes exact caps', () => {
    expect(MAX_REQUEST_BYTES).toBe(16_384)
    expect(MAX_MODEL_OUTPUT_BYTES).toBe(2_048)
    expect(MAX_BARK_CODEPOINTS).toBe(48)
    expect(INTENT_TIMEOUT_MS).toBe(1_200)
    expect(LEASE_MIN_TICKS).toBe(4)
    expect(LEASE_MAX_TICKS).toBe(12)
  })

  it('accepts one exact legal object and rejects trailing text', () => {
    const value = JSON.stringify({
      version: 1,
      requestId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
      decisionEpoch: 2,
      proposal: { intent: 'decoy', bark: 'Take the core. I will draw it away.' },
      leaseTicks: 8,
    })
    expect(parseIntentResponse(value).ok).toBe(true)
    expect(parseIntentResponse(`${value}\nextra`)).toEqual({ ok: false, reason: 'json' })
  })

  it('removes control code points and rejects overlong bark rather than truncating', () => {
    const base = {
      version: 1,
      requestId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
      decisionEpoch: 2,
      leaseTicks: 8,
    }
    expect(
      parseIntentResponse(
        JSON.stringify({ ...base, proposal: { intent: 'follow', bark: 'a'.repeat(49) } })
      )
    ).toEqual({ ok: false, reason: 'bark' })
    expect(
      parseIntentResponse(
        JSON.stringify({ ...base, proposal: { intent: 'follow', bark: 'safe\u0007' } })
      )
    ).toMatchObject({ ok: true, value: { proposal: { bark: 'safe' } } })
  })
})
