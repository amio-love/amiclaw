import { describe, expect, it } from 'vitest'
import type { LeaderboardEntry, ScoreSubmission } from '../../../../shared/leaderboard-types'
import { handlePostScore } from './post-score'

const VALID_DEVICE_ID = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'

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

function submission(overrides: Partial<ScoreSubmission> = {}): ScoreSubmission {
  const moduleTimes = [40_000, 35_000, 30_000, 25_000]
  return {
    date: new Date().toISOString().slice(0, 10),
    nickname: '小明',
    time_ms: moduleTimes.reduce((a, b) => a + b, 0),
    attempt_number: 1,
    module_times: moduleTimes,
    operations_hash: 'mvp-placeholder',
    ai_tool: 'claude',
    device_id: VALID_DEVICE_ID,
    ...overrides,
  }
}

function request(body: unknown): Request {
  return new Request('https://claw.amio.fans/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('handlePostScore — leaderboard AI metadata', () => {
  it('stores Chinese nicknames and sanitized AI metadata', async () => {
    const kv = new FakeKV()
    const response = await handlePostScore(
      request(
        submission({
          nickname: '<b>小明✨</b>',
          ai_tool: 'Claude✨',
          ai_model: '  Claude Sonnet 4.5✨  ',
        })
      ),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(
      `leaderboard:${new Date().toISOString().slice(0, 10)}`,
      'json'
    )) as LeaderboardEntry[] | null
    expect(entries?.[0]).toMatchObject({
      nickname: '小明',
      ai_tool: 'Claude',
      ai_model: 'Claude Sonnet 4.5',
    })
  })

  it('omits blank optional model text instead of storing an empty string', async () => {
    const kv = new FakeKV()
    const response = await handlePostScore(
      request(submission({ ai_tool: 'Gemini', ai_model: '   ' })),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(
      `leaderboard:${new Date().toISOString().slice(0, 10)}`,
      'json'
    )) as LeaderboardEntry[] | null
    expect(entries?.[0]).toMatchObject({ ai_tool: 'Gemini' })
    expect(entries?.[0]).not.toHaveProperty('ai_model')
  })

  it('keeps legacy rows readable while adding new metadata rows', async () => {
    const kv = new FakeKV()
    const date = new Date().toISOString().slice(0, 10)
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([{ rank: 1, nickname: 'Legacy', time_ms: 150_000, attempt_number: 1 }])
    )

    const response = await handlePostScore(
      request(submission({ time_ms: 130_000, ai_tool: 'chatgpt' })),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(`leaderboard:${date}`, 'json')) as LeaderboardEntry[] | null
    expect(entries).toEqual([
      expect.objectContaining({ rank: 1, nickname: '小明', ai_tool: 'chatgpt' }),
      expect.objectContaining({ rank: 2, nickname: 'Legacy' }),
    ])
  })
})
