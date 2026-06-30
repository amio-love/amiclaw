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

describe('handleGetLeaderboard — run_id privacy', () => {
  // run_id is an internal backend dedup key. It must never reach the public
  // leaderboard response, or it would leak a stable per-run identifier.
  it('strips the internal run_id from every entry in the public response', async () => {
    const kv = new FakeKV()
    const date = '2026-06-30'
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        { rank: 1, nickname: '小明', time_ms: 130_000, attempt_number: 1, run_id: 'run-x' },
        { rank: 2, nickname: '小红', time_ms: 140_000, attempt_number: 1, run_id: 'run-y' },
      ])
    )

    const response = await handleGetLeaderboard(request(date), kv as unknown as KVNamespace)
    expect(response.status).toBe(200)
    const body = (await response.json()) as LeaderboardResponse
    expect(body.entries).toHaveLength(2)
    for (const entry of body.entries) {
      expect(entry).not.toHaveProperty('run_id')
    }
    // The public fields survive intact.
    expect(body.entries[0]).toMatchObject({ rank: 1, nickname: '小明', time_ms: 130_000 })
  })
})
