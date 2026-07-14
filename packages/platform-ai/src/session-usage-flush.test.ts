import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildUsageRecord,
  flushSessionUsage,
  usageKeyFor,
  type SessionUsageSnapshot,
  type UsageKvWriter,
} from './usage-flush'
import type { UsageCounters } from './turn-pipeline'

/**
 * Tests for the pure `usage-flush.ts` core (P3 of the usage-metering task):
 * the key scheme, the record shape, and the FAIL-OPEN write (an absent USAGE
 * binding skips silently; a KV failure logs and is swallowed — session
 * teardown is never blocked either way).
 *
 * The DO-side wiring of this core — the exactly-once / all-terminal-paths
 * flush contract (L2 §Mechanism Variant 4) — is covered against the REAL
 * `VoiceSessionDO` in `session-do-usage-flush.test.ts`; an earlier
 * `FakeSessionDo` mirror of that wiring lived here and was retired once the
 * production-class suite covered every behavior it asserted.
 */

// --- KV test doubles ----------------------------------------------------------

/** Recording KV double implementing the structural `put` slice. */
class FakeUsageKv implements UsageKvWriter {
  readonly puts: Array<{ key: string; value: string }> = []

  async put(key: string, value: string): Promise<void> {
    this.puts.push({ key, value })
  }
}

/** KV double whose every put rejects — the fail-open injection point. */
class FailingUsageKv implements UsageKvWriter {
  attempts = 0

  async put(): Promise<void> {
    this.attempts += 1
    throw new Error('kv unavailable')
  }
}

const COUNTERS: UsageCounters = {
  llmInputTokens: 100,
  llmOutputTokens: 50,
  sttInputSeconds: 12.5,
  ttsOutputSeconds: 8.25,
}

function snapshot(overrides: Partial<SessionUsageSnapshot> = {}): SessionUsageSnapshot {
  return {
    sessionId: 'session-uuid-1',
    userId: 'user-A',
    gameId: 'demo-mock',
    turnCount: 3,
    usage: { ...COUNTERS },
    sttSource: 'provider-reported',
    fundingSource: 'earned',
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// --- pure core: key + record + fail-open --------------------------------------

describe('usageKeyFor', () => {
  it('builds usage:{date}:{user_id}:{session_id} with the UTC date at flush time', () => {
    // 23:30 UTC on the 11th is already the 12th in UTC+8 — the key must use
    // UTC, not the local calendar.
    const flushedAt = new Date('2026-06-11T23:30:00Z')
    expect(usageKeyFor(flushedAt, 'user-A', 'session-uuid-1')).toBe(
      'usage:2026-06-11:user-A:session-uuid-1'
    )
  })
})

describe('buildUsageRecord', () => {
  it('carries the four counters, sttSource, gameId, turnCount, and the flush timestamp', () => {
    const flushedAt = new Date('2026-06-11T08:00:00Z')
    expect(buildUsageRecord(snapshot(), flushedAt)).toEqual({
      gameId: 'demo-mock',
      turnCount: 3,
      usage: COUNTERS,
      sttSource: 'provider-reported',
      fundingSource: 'earned',
      flushedAt: '2026-06-11T08:00:00.000Z',
    })
  })

  it('carries the reward-economy funding source (v1 always earned)', () => {
    const record = buildUsageRecord(snapshot(), new Date('2026-06-11T08:00:00Z'))
    expect(record.fundingSource).toBe('earned')
  })

  it('copies the counters instead of aliasing the live session object', () => {
    const snap = snapshot()
    const record = buildUsageRecord(snap, new Date('2026-06-11T08:00:00Z'))
    snap.usage.llmInputTokens = 999999
    expect(record.usage.llmInputTokens).toBe(100)
  })
})

describe('flushSessionUsage — fail-open', () => {
  it('writes one record under the usage key', async () => {
    const kv = new FakeUsageKv()
    await flushSessionUsage(kv, snapshot(), new Date('2026-06-11T08:00:00Z'))

    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toBe('usage:2026-06-11:user-A:session-uuid-1')
    expect(JSON.parse(kv.puts[0].value)).toEqual({
      gameId: 'demo-mock',
      turnCount: 3,
      usage: COUNTERS,
      sttSource: 'provider-reported',
      fundingSource: 'earned',
      flushedAt: '2026-06-11T08:00:00.000Z',
    })
  })

  it('skips silently when the USAGE binding is absent (dev/demo deploys)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(flushSessionUsage(undefined, snapshot())).resolves.toBeUndefined()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs and swallows a KV put failure — never rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const kv = new FailingUsageKv()

    await expect(flushSessionUsage(kv, snapshot())).resolves.toBeUndefined()

    expect(kv.attempts).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('usage flush failed for usage:')
  })
})
