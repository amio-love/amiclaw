import { describe, expect, it } from 'vitest'
import type {
  LeaderboardEntry,
  ScoreSubmission,
  ScoreSubmissionResponse,
} from '../../../../shared/leaderboard-types'
import type { CompanionDb } from '../../../companion-memory/src/db'
import { creditWinReward } from '../../../companion-memory/src/ledger'
import { createTestDb } from '../../../companion-memory/src/test-support/sqlite-db'
import type {
  CaptureEventRecord,
  SettlementCaptureInput,
} from '../../../companion-memory/src/types'
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

  asKV(): KVNamespace {
    return this as unknown as KVNamespace
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

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://claw.amio.fans/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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

describe('handlePostScore — authenticated settlement capture', () => {
  it('captures a logged-in score settlement with the same run_id as game_run_id', async () => {
    const leaderboardKv = new FakeKV()
    const authKv = new FakeKV()
    await authKv.put(
      'session:sess-a',
      JSON.stringify({
        user_id: 'user-a',
        email: 'a@example.com',
        created_at: '2026-07-04T00:00:00.000Z',
      })
    )
    const db = createTestDb()

    const response = await handlePostScore(
      request(submission({ run_id: 'run-123' }), { Cookie: 'amiclaw_session=sess-a' }),
      leaderboardKv.asKV(),
      {
        auth: authKv.asKV(),
        companionDb: db,
        now: () => '2026-07-04T12:00:00.000Z',
      }
    )

    expect(response.status).toBe(200)
    const row = await db
      .prepare(
        `SELECT event_id, user_id, kind, game_id, game_run_id, payload, occurred_at
         FROM capture_event`
      )
      .bind()
      .first<CaptureEventRecord>()
    expect(row).toMatchObject({
      event_id: 'settlement:run-123',
      user_id: 'user-a',
      kind: 'settlement',
      game_id: 'bombsquad',
      game_run_id: 'run-123',
      occurred_at: '2026-07-04T12:00:00.000Z',
    })
    const payload = JSON.parse(row?.payload ?? '{}') as SettlementCaptureInput
    expect(payload).toMatchObject({
      settlementId: 'run-123',
      userId: 'user-a',
      gameId: 'bombsquad',
      gameRunId: 'run-123',
      outcome: 'win',
      durationSeconds: 130,
      occurredAt: '2026-07-04T12:00:00.000Z',
    })
  })

  it('keeps anonymous submissions successful and memory-free', async () => {
    const leaderboardKv = new FakeKV()
    const authKv = new FakeKV()
    const db = createTestDb()

    const response = await handlePostScore(
      request(submission({ run_id: 'run-anon' })),
      leaderboardKv.asKV(),
      {
        auth: authKv.asKV(),
        companionDb: db,
      }
    )

    expect(response.status).toBe(200)
    const rows = await db.prepare('SELECT event_id FROM capture_event').bind().all()
    expect(rows.results).toHaveLength(0)
  })
})

describe('handlePostScore — run_id idempotency', () => {
  // A run carries a stable client-generated run_id. Re-submitting the same run
  // (page refresh, retry, or a KV-race double-POST) must REPLACE the existing
  // row, not append a second one — otherwise the leaderboard shows duplicates.
  it('replaces an existing entry with the same run_id instead of appending', async () => {
    const kv = new FakeKV()
    const date = new Date().toISOString().slice(0, 10)
    // Pre-seed the same run already on the board (its first, slower submit).
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        { rank: 1, nickname: '小明', time_ms: 150_000, attempt_number: 1, run_id: 'run-x' },
      ])
    )

    const response = await handlePostScore(
      request(submission({ time_ms: 130_000, run_id: 'run-x' })),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(`leaderboard:${date}`, 'json')) as Array<
      LeaderboardEntry & { run_id?: string }
    > | null
    // Exactly one row for the run — the resubmission replaced the prior one.
    expect(entries).toHaveLength(1)
    expect(entries?.[0]).toMatchObject({ rank: 1, time_ms: 130_000, run_id: 'run-x' })
  })

  it('appends runs that carry distinct run_ids from different devices', async () => {
    const kv = new FakeKV()
    const date = new Date().toISOString().slice(0, 10)
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        { rank: 1, nickname: '小红', time_ms: 120_000, attempt_number: 1, run_id: 'run-x' },
      ])
    )

    const response = await handlePostScore(
      request(submission({ time_ms: 130_000, run_id: 'run-y' })),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(`leaderboard:${date}`, 'json')) as LeaderboardEntry[] | null
    expect(entries).toHaveLength(2)
  })
})

describe('handlePostScore — one row per player per day', () => {
  type StoredRow = LeaderboardEntry & { run_id?: string; device_id?: string }
  const date = new Date().toISOString().slice(0, 10)

  it('replaces the player row when a new run beats their existing best', async () => {
    const kv = new FakeKV()
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        {
          rank: 1,
          nickname: '小明',
          time_ms: 150_000,
          attempt_number: 1,
          device_id: VALID_DEVICE_ID,
          run_id: 'run-1',
        },
      ])
    )

    const response = await handlePostScore(
      request(submission({ time_ms: 130_000, attempt_number: 2, run_id: 'run-2' })),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(`leaderboard:${date}`, 'json')) as StoredRow[] | null
    expect(entries).toHaveLength(1)
    expect(entries?.[0]).toMatchObject({ rank: 1, time_ms: 130_000, attempt_number: 2 })
  })

  it('keeps the existing best and ranks it when a new run is slower', async () => {
    const kv = new FakeKV()
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        {
          rank: 1,
          nickname: '小红',
          time_ms: 100_000,
          attempt_number: 1,
          device_id: 'cccccccc-dddd-4eee-9fff-000000000000',
          run_id: 'run-other',
        },
        {
          rank: 2,
          nickname: '小明',
          time_ms: 120_000,
          attempt_number: 1,
          device_id: VALID_DEVICE_ID,
          run_id: 'run-1',
        },
      ])
    )

    const response = await handlePostScore(
      request(
        submission({
          time_ms: 150_000,
          module_times: [45_000, 40_000, 35_000, 29_000],
          attempt_number: 2,
          run_id: 'run-2',
        })
      ),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(`leaderboard:${date}`, 'json')) as StoredRow[] | null
    // The slower retry did not create a second row for the player.
    expect(entries).toHaveLength(2)
    expect(entries?.[1]).toMatchObject({ rank: 2, time_ms: 120_000, attempt_number: 1 })
    // The response rank points at the player's kept (best) row.
    const body = (await response.json()) as { rank: number; total_players: number }
    expect(body.rank).toBe(2)
    expect(body.total_players).toBe(2)
  })

  it('keeps same-nickname submissions from different devices as separate rows', async () => {
    const kv = new FakeKV()
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        {
          rank: 1,
          nickname: '小明',
          time_ms: 120_000,
          attempt_number: 1,
          device_id: 'cccccccc-dddd-4eee-9fff-000000000000',
          run_id: 'run-other',
        },
      ])
    )

    const response = await handlePostScore(
      request(submission({ time_ms: 130_000, run_id: 'run-mine' })),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const entries = (await kv.get(`leaderboard:${date}`, 'json')) as StoredRow[] | null
    expect(entries).toHaveLength(2)
  })

  it('keeps per-day boards independent — a submission never touches another day', async () => {
    const kv = new FakeKV()
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    await kv.put(
      `leaderboard:${yesterday}`,
      JSON.stringify([
        {
          rank: 1,
          nickname: '小明',
          time_ms: 150_000,
          attempt_number: 1,
          device_id: VALID_DEVICE_ID,
          run_id: 'run-old',
        },
      ])
    )

    const response = await handlePostScore(
      request(submission({ time_ms: 130_000, run_id: 'run-new' })),
      kv as unknown as KVNamespace
    )

    expect(response.status).toBe(200)
    const todayEntries = (await kv.get(`leaderboard:${date}`, 'json')) as StoredRow[] | null
    const yesterdayEntries = (await kv.get(`leaderboard:${yesterday}`, 'json')) as
      | StoredRow[]
      | null
    expect(todayEntries).toHaveLength(1)
    expect(todayEntries?.[0]).toMatchObject({ time_ms: 130_000 })
    expect(yesterdayEntries).toHaveLength(1)
    expect(yesterdayEntries?.[0]).toMatchObject({ time_ms: 150_000 })
  })
})

describe('handlePostScore — win reward (reward-economy §3)', () => {
  // A leaderboard POST only fires on a defusal, so an authenticated submission
  // IS a bombsquad win. Pin the clock so the daily-cap window is deterministic.
  const NOW = '2026-07-04T12:00:00.000Z'
  const TODAY = '2026-07-04'
  const WIN_SOURCE_KEY = `win:bombsquad:${'user-a'.length}:user-a:`

  async function authKvWithSession(userId = 'user-a'): Promise<FakeKV> {
    const authKv = new FakeKV()
    await authKv.put(
      'session:sess-a',
      JSON.stringify({ user_id: userId, email: `${userId}@example.com`, created_at: NOW })
    )
    return authKv
  }

  // A fresh leaderboard KV per call sidesteps the per-device 10 s rate limit,
  // so replay calls with the same device reach the reward path.
  function authedWin(runId: string, authKv: FakeKV, db: CompanionDb): Promise<Response> {
    return handlePostScore(
      request(submission({ run_id: runId }), { Cookie: 'amiclaw_session=sess-a' }),
      new FakeKV().asKV(),
      { auth: authKv.asKV(), companionDb: db, now: () => NOW }
    )
  }

  it('credits +5 and returns the reward for an authenticated win', async () => {
    const authKv = await authKvWithSession()
    const db = createTestDb()

    const response = await authedWin('run-win', authKv, db)

    expect(response.status).toBe(200)
    const body = (await response.json()) as ScoreSubmissionResponse
    expect(body.reward).toEqual({
      asset_type: 'starburst',
      amount: 5,
      status: 'credited',
      balance: 5,
    })
    const row = await db
      .prepare("SELECT amount, source_key FROM asset_entry WHERE source_key GLOB 'win:*'")
      .bind()
      .first<{ amount: number; source_key: string }>()
    expect(row?.amount).toBe(5)
    expect(row?.source_key).toBe(`${WIN_SOURCE_KEY}run-win`)
  })

  it('does not double-credit a replayed run and reflects duplicate in the response', async () => {
    const authKv = await authKvWithSession()
    const db = createTestDb()

    const first = await authedWin('run-dup', authKv, db)
    const second = await authedWin('run-dup', authKv, db)

    expect(((await first.json()) as ScoreSubmissionResponse).reward?.status).toBe('credited')
    const secondBody = (await second.json()) as ScoreSubmissionResponse
    expect(secondBody.reward).toEqual({
      asset_type: 'starburst',
      amount: 0,
      status: 'duplicate',
      balance: 5,
    })
    // Exactly one CREDITED win row — the replay did not add a second.
    const rows = await db
      .prepare("SELECT amount FROM asset_entry WHERE source_key GLOB 'win:*' AND amount > 0")
      .bind()
      .all()
    expect(rows.results).toHaveLength(1)
  })

  it('caps at the daily win limit and returns a zero-amount capped reward', async () => {
    const authKv = await authKvWithSession()
    const db = createTestDb()
    let seq = 0
    const seedDeps = { now: () => '2026-07-04T06:00:00.000Z', newId: () => `seed-${seq++}` }
    // Four rewarded wins already today (the cap), across distinct runs.
    for (let i = 0; i < 4; i += 1) {
      await creditWinReward(db, {
        userId: 'user-a',
        gameId: 'bombsquad',
        runId: `seed-run-${i}`,
        today: TODAY,
        deps: seedDeps,
      })
    }

    const response = await authedWin('run-5', authKv, db)

    const body = (await response.json()) as ScoreSubmissionResponse
    expect(body.reward).toEqual({
      asset_type: 'starburst',
      amount: 0,
      status: 'capped',
      balance: 20, // 4 x 5; the capped marker is amount 0
    })
  })

  it('keeps the settlement successful with no reward field when the ledger throws', async () => {
    const authKv = await authKvWithSession()
    const throwingDb = {
      prepare() {
        throw new Error('D1 unavailable')
      },
      batch() {
        return Promise.reject(new Error('D1 unavailable'))
      },
    } as unknown as CompanionDb

    const response = await authedWin('run-fail', authKv, throwingDb)

    expect(response.status).toBe(200)
    const body = (await response.json()) as ScoreSubmissionResponse
    expect(body).not.toHaveProperty('reward')
  })

  it('never credits or returns a reward for an anonymous submitter', async () => {
    const authKv = new FakeKV() // no session stored
    const db = createTestDb()

    const response = await handlePostScore(
      request(submission({ run_id: 'run-anon-win' })),
      new FakeKV().asKV(),
      { auth: authKv.asKV(), companionDb: db, now: () => NOW }
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as ScoreSubmissionResponse
    expect(body).not.toHaveProperty('reward')
    const rows = await db
      .prepare("SELECT amount FROM asset_entry WHERE source_key GLOB 'win:*'")
      .bind()
      .all()
    expect(rows.results).toHaveLength(0)
  })
})

describe('handlePostScore — plausibility floor in the returned rank (F2)', () => {
  type StoredRow = LeaderboardEntry & { device_id?: string }

  it('ranks a legit submission ahead of legacy sub-floor rows and counts only plausible players', async () => {
    const kv = new FakeKV()
    const date = new Date().toISOString().slice(0, 10)
    // Two legacy sub-60s junk rows already on the board (written before the
    // plausibility floor shipped, still inside the 48h TTL).
    await kv.put(
      `leaderboard:${date}`,
      JSON.stringify([
        {
          rank: 1,
          nickname: '审计员W4',
          time_ms: 36_000,
          attempt_number: 1,
          device_id: 'dddddddd-eeee-4fff-9aaa-bbbbbbbbbbbb',
        },
        {
          rank: 2,
          nickname: '审计员W3',
          time_ms: 36_500,
          attempt_number: 1,
          device_id: 'cccccccc-1111-4222-9333-444444444444',
        },
      ])
    )

    // A genuine 130s run from a different device.
    const response = await handlePostScore(request(submission()), kv.asKV())
    expect(response.status).toBe(200)
    const body = (await response.json()) as ScoreSubmissionResponse
    // The returned rank / count ignore the two sub-floor rows: the submitter is
    // #1 of 1 plausible player, NOT #3 of 3 behind the 00:36 junk.
    expect(body.rank).toBe(1)
    expect(body.total_players).toBe(1)

    // The KV write still PRESERVES the sub-floor rows — the sweep is a display
    // filter, not a hard delete, so they age out with the TTL on their own.
    const stored = (await kv.get(`leaderboard:${date}`, 'json')) as StoredRow[] | null
    expect(stored?.some((e) => e.time_ms === 36_000)).toBe(true)
    expect(stored?.some((e) => e.time_ms === 36_500)).toBe(true)
    expect(stored?.some((e) => e.time_ms === 130_000)).toBe(true)
  })
})
