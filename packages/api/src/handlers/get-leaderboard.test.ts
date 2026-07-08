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

describe('handleGetLeaderboard — plausibility-floor integrity sweep (F2)', () => {
  // Legacy sub-floor rows (written before the 60s plausibility floor shipped,
  // still inside the 48h KV TTL) must not headline the board or poison the
  // homepage 最快拆弹 stat that reads entries[0]. The read path filters them out
  // at display time — a reversible sweep that leaves the data in KV to age out.
  it('hides sub-floor rows so only plausible times surface, and re-ranks', async () => {
    const kv = new FakeKV()
    const date = '2026-06-30'
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        { rank: 1, nickname: '审计员W4', time_ms: 36_000, attempt_number: 1 }, // sub-60s junk
        { rank: 2, nickname: '审计员W3', time_ms: 36_500, attempt_number: 1 }, // sub-60s junk
        { rank: 3, nickname: '真人玩家', time_ms: 182_000, attempt_number: 2 },
      ])
    )

    const response = await handleGetLeaderboard(request(date), kv as unknown as KVNamespace)
    expect(response.status).toBe(200)
    const body = (await response.json()) as LeaderboardResponse
    // The two implausible rows are gone; the plausible run is now #1, so the
    // homepage 最快拆弹 (= entries[0].time_ms) reads 182_000, not 36_000.
    expect(body.entries).toEqual([
      { rank: 1, nickname: '真人玩家', time_ms: 182_000, attempt_number: 2 },
    ])
  })

  it('keeps a player who has both an implausible and a plausible row, via the plausible one', async () => {
    const kv = new FakeKV()
    const date = '2026-06-30'
    const device = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        { rank: 1, nickname: '快手', time_ms: 40_000, attempt_number: 2, device_id: device },
        { rank: 2, nickname: '快手', time_ms: 95_000, attempt_number: 1, device_id: device },
      ])
    )

    const response = await handleGetLeaderboard(request(date), kv as unknown as KVNamespace)
    const body = (await response.json()) as LeaderboardResponse
    // Filtering runs BEFORE dedup, so the sub-floor 40s row does not win dedup
    // and then vanish — the player still surfaces on their plausible 95s row.
    expect(body.entries).toEqual([
      { rank: 1, nickname: '快手', time_ms: 95_000, attempt_number: 1 },
    ])
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
