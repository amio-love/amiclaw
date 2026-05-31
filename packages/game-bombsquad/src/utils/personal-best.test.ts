import { describe, expect, it } from 'vitest'
import { computeBestRecord } from '@shared/personal-best'

describe('computeBestRecord', () => {
  it('treats fresh KV (null) as a new best and stamps attempt_number', () => {
    const submission = { time_ms: 180_000, attempt_number: 1 }
    const { record, isNewBest } = computeBestRecord(null, submission)
    expect(isNewBest).toBe(true)
    expect(record.time_ms).toBe(180_000)
    expect(record.attempt_number).toBe(1)
  })

  it('keeps legacy record (no attempt_number) on a slower submission, omitting the field entirely', () => {
    const legacy = { time_ms: 200_000 } // legacy KV: no attempt_number key
    const submission = { time_ms: 250_000, attempt_number: 3 }
    const { record, isNewBest } = computeBestRecord(legacy, submission)
    expect(isNewBest).toBe(false)
    expect(record.time_ms).toBe(200_000)
    // Field must be absent (not undefined) — verifies JSON serialization omits the key.
    expect('attempt_number' in record).toBe(false)
    expect(JSON.stringify(record)).toBe('{"time_ms":200000}')
  })

  it('preserves the original attempt_number on a tie (older record wins)', () => {
    const existing = { time_ms: 175_000, attempt_number: 2 }
    const submission = { time_ms: 175_000, attempt_number: 5 }
    const { record, isNewBest } = computeBestRecord(existing, submission)
    expect(isNewBest).toBe(false)
    expect(record.time_ms).toBe(175_000)
    expect(record.attempt_number).toBe(2)
  })

  it('returns isNewBest=true only when the submission is strictly faster', () => {
    const existing = { time_ms: 200_000, attempt_number: 1 }
    const faster = { time_ms: 199_999, attempt_number: 4 }
    const { record, isNewBest } = computeBestRecord(existing, faster)
    expect(isNewBest).toBe(true)
    expect(record.time_ms).toBe(199_999)
    expect(record.attempt_number).toBe(4)
  })
})
