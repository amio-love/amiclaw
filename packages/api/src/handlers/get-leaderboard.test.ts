import { describe, expect, it } from 'vitest'
import type { LeaderboardResponse } from '../../../../shared/leaderboard-types'
import { handleGetLeaderboard } from './get-leaderboard'

class FakeKV {
  private readonly store = new Map<string, string>()

  async get(key: string, type?: 'json'): Promise<unknown> {
    const value = this.store.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) : value
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }
}

function request(date: string): Request {
  return new Request(`https://claw.amio.fans/api/leaderboard?date=${date}`, { method: 'GET' })
}

describe('handleGetLeaderboard — internal key privacy', () => {
  // run_id (per-run idempotency) and device_id (per-player dedup) are internal
  // backend keys. They must never reach the public leaderboard response, or
  // they would leak stable per-run / per-device identifiers.
  it('strips the internal run_id and device_id from every entry in the public response', async () => {
    const kv = new FakeKV()
    const date = '2026-06-30'
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        {
          rank: 1,
          nickname: '小明',
          time_ms: 130_000,
          attempt_number: 1,
          run_id: 'run-x',
          device_id: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
        },
        { rank: 2, nickname: '小红', time_ms: 140_000, attempt_number: 1, run_id: 'run-y' },
      ])
    )

    const response = await handleGetLeaderboard(request(date), kv as unknown as KVNamespace)
    expect(response.status).toBe(200)
    const body = (await response.json()) as LeaderboardResponse
    expect(body.entries).toHaveLength(2)
    for (const entry of body.entries) {
      expect(entry).not.toHaveProperty('run_id')
      expect(entry).not.toHaveProperty('device_id')
    }
    // The public fields survive intact.
    expect(body.entries[0]).toMatchObject({ rank: 1, nickname: '小明', time_ms: 130_000 })
  })
})

describe('handleGetLeaderboard — read-time dedup of historical rows', () => {
  // Rows written before write-time per-player dedup shipped can contain the
  // same player several times. The GET collapses them (best time wins) so
  // historical boards stay honest until the 48h KV TTL ages them out.
  it('collapses duplicate legacy rows sharing a nickname and re-ranks', async () => {
    const kv = new FakeKV()
    const date = '2026-06-30'
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        { rank: 1, nickname: '审计员07', time_ms: 130_000, attempt_number: 1 },
        { rank: 2, nickname: '审计员07', time_ms: 140_000, attempt_number: 1 },
        { rank: 3, nickname: '小红', time_ms: 150_000, attempt_number: 2 },
      ])
    )

    const response = await handleGetLeaderboard(request(date), kv as unknown as KVNamespace)
    expect(response.status).toBe(200)
    const body = (await response.json()) as LeaderboardResponse
    expect(body.entries).toEqual([
      { rank: 1, nickname: '审计员07', time_ms: 130_000, attempt_number: 1 },
      { rank: 2, nickname: '小红', time_ms: 150_000, attempt_number: 2 },
    ])
  })
})
