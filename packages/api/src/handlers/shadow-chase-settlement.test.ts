import { describe, expect, it, vi } from 'vitest'

import type { WinReward } from '../../../../shared/reward-types'
import type { CompanionDb } from '../../../companion-memory/src/db'
import { createSession, buildSessionCookie } from '../auth/session'
import { FakeKV } from '../auth/fake-kv'
import { createTestDb } from '../../../companion-memory/src/test-support/sqlite-db'
import {
  handlePostShadowChaseSettlement,
  MAX_SETTLEMENT_REQUEST_BYTES,
  settlementIdFor,
  SHADOW_CHASE_GAME_ID,
  type SettlementScheduler,
} from './shadow-chase-settlement'

const RUN_ID = '00000000-0000-4000-8000-000000000009'
const NOW = '2026-07-10T08:00:00.000Z'

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    runId: RUN_ID,
    outcome: 'win',
    durationTicks: 800,
    ...overrides,
  }
}

function request(payload: unknown = body(), headers: Record<string, string> = {}): Request {
  return new Request('https://claw.amio.fans/api/shadow-chase/settlement', {
    method: 'POST',
    headers: {
      Origin: 'https://claw.amio.fans',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

async function authenticated(userId = 'user-a'): Promise<{ auth: FakeKV; cookie: string }> {
  const auth = new FakeKV()
  const { sessionId } = await createSession(auth.asKV(), {
    user_id: userId,
    email: `${userId}@example.com`,
  })
  return { auth, cookie: buildSessionCookie(sessionId).split(';')[0] }
}

function collectingScheduler(): SettlementScheduler & { promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = []
  return {
    promises,
    schedule(promise) {
      promises.push(promise)
    },
  }
}

describe('settlementIdFor', () => {
  it('is stable for one game/owner/run and distinct across owners and games', () => {
    const same = settlementIdFor(SHADOW_CHASE_GAME_ID, 'user-a', RUN_ID)
    expect(settlementIdFor(SHADOW_CHASE_GAME_ID, 'user-a', RUN_ID)).toBe(same)
    expect(settlementIdFor(SHADOW_CHASE_GAME_ID, 'user-b', RUN_ID)).not.toBe(same)
    expect(settlementIdFor('other-game', 'user-a', RUN_ID)).not.toBe(same)
    expect(same).toBe(`${SHADOW_CHASE_GAME_ID}:6:user-a:${RUN_ID}`)
  })
})

describe('handlePostShadowChaseSettlement', () => {
  it('derives the owner from the session, schedules capture, and returns 202 only after registration', async () => {
    const { auth, cookie } = await authenticated('user-a')
    const db = createTestDb()
    const scheduler = collectingScheduler()
    const response = await handlePostShadowChaseSettlement(
      request(body(), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: db },
      { scheduler, now: () => NOW }
    )

    expect(response.status).toBe(202)
    // A win now also carries the credited reward; this test pins owner
    // derivation + capture scheduling, so match the envelope loosely.
    expect(await response.json()).toMatchObject({ accepted: true })
    expect(scheduler.promises).toHaveLength(1)
    await Promise.all(scheduler.promises)

    const row = await db
      .prepare(
        'SELECT event_id, user_id, game_id, game_run_id, payload, occurred_at FROM capture_event'
      )
      .first<{
        event_id: string
        user_id: string
        game_id: string
        game_run_id: string
        payload: string
        occurred_at: string
      }>()
    expect(row?.user_id).toBe('user-a')
    expect(row?.game_id).toBe(SHADOW_CHASE_GAME_ID)
    expect(row?.game_run_id).toBe(RUN_ID)
    expect(row?.event_id).toContain('settlement:shadow-chase:6:user-a:')
    expect(JSON.parse(row?.payload ?? '{}')).toMatchObject({
      outcome: 'win',
      durationSeconds: 200,
      occurredAt: NOW,
      gameRunId: RUN_ID,
    })
  })

  it('delivers duplicate owner/run settlements idempotently', async () => {
    const { auth, cookie } = await authenticated('user-a')
    const db = createTestDb()
    const scheduler = collectingScheduler()
    const env = { AUTH: auth.asKV(), COMPANION_DB: db }
    const options = { scheduler, now: () => NOW }

    expect(
      (await handlePostShadowChaseSettlement(request(body(), { Cookie: cookie }), env, options))
        .status
    ).toBe(202)
    expect(
      (await handlePostShadowChaseSettlement(request(body(), { Cookie: cookie }), env, options))
        .status
    ).toBe(202)
    await Promise.all(scheduler.promises)

    const count = await db.prepare('SELECT COUNT(*) AS count FROM capture_event').first<{
      count: number
    }>()
    expect(count?.count).toBe(1)
  })

  it.each([
    ['owner', { owner: 'forged' }],
    ['game id', { gameId: 'other-game' }],
    ['assets', { assets: [{ assetType: 'spark', amount: 999 }] }],
    ['memory', { memory: 'forged narrative' }],
  ])('rejects body-supplied %s before scheduling', async (_name, extra) => {
    const { auth, cookie } = await authenticated()
    const scheduler = collectingScheduler()
    const response = await handlePostShadowChaseSettlement(
      request(body(extra), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: createTestDb() },
      { scheduler, now: () => NOW }
    )
    expect(response.status).toBe(422)
    expect(scheduler.promises).toHaveLength(0)
  })

  it.each([
    ['uuid', { runId: 'not-a-uuid' }],
    ['outcome', { outcome: 'draw' }],
    ['zero duration', { durationTicks: 0 }],
    ['over duration', { durationTicks: 1_201 }],
    ['fractional duration', { durationTicks: 1.5 }],
  ])('rejects invalid %s with 422', async (_name, extra) => {
    const { auth, cookie } = await authenticated()
    const response = await handlePostShadowChaseSettlement(
      request(body(extra), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: createTestDb() },
      { scheduler: collectingScheduler(), now: () => NOW }
    )
    expect(response.status).toBe(422)
  })

  it('maps method, origin, content type, malformed JSON, body cap, and anonymous session exactly', async () => {
    const { auth, cookie } = await authenticated()
    const env = { AUTH: auth.asKV(), COMPANION_DB: createTestDb() }
    const options = { scheduler: collectingScheduler(), now: () => NOW }

    expect(
      (
        await handlePostShadowChaseSettlement(
          new Request('https://claw.amio.fans/api/shadow-chase/settlement', { method: 'GET' }),
          env,
          options
        )
      ).status
    ).toBe(405)
    expect(
      (
        await handlePostShadowChaseSettlement(
          request(body(), { Origin: 'https://evil.example', Cookie: cookie }),
          env,
          options
        )
      ).status
    ).toBe(403)
    expect(
      (
        await handlePostShadowChaseSettlement(
          request(body(), { 'Content-Type': 'text/plain', Cookie: cookie }),
          env,
          options
        )
      ).status
    ).toBe(415)
    expect(
      (
        await handlePostShadowChaseSettlement(
          request('{bad json', { Cookie: cookie }),
          env,
          options
        )
      ).status
    ).toBe(400)
    expect(
      (
        await handlePostShadowChaseSettlement(
          request('x'.repeat(MAX_SETTLEMENT_REQUEST_BYTES + 1), {
            Cookie: cookie,
            'Content-Length': String(MAX_SETTLEMENT_REQUEST_BYTES + 1),
          }),
          env,
          options
        )
      ).status
    ).toBe(413)
    expect((await handlePostShadowChaseSettlement(request(), env, options)).status).toBe(401)
  })

  it('returns 503 for missing bindings or scheduler throw, and 500 for unexpected pre-handoff faults', async () => {
    const { auth, cookie } = await authenticated()
    const capture = vi.fn(async () => ({ captured: true }))
    const incoming = request(body(), { Cookie: cookie })
    expect(
      (
        await handlePostShadowChaseSettlement(
          incoming.clone(),
          { COMPANION_DB: createTestDb() },
          { scheduler: collectingScheduler(), capture }
        )
      ).status
    ).toBe(503)
    expect(
      (
        await handlePostShadowChaseSettlement(
          incoming.clone(),
          { AUTH: auth.asKV() },
          { scheduler: collectingScheduler(), capture }
        )
      ).status
    ).toBe(503)
    expect(
      (
        await handlePostShadowChaseSettlement(
          incoming.clone(),
          { AUTH: auth.asKV(), COMPANION_DB: createTestDb() },
          {
            scheduler: {
              schedule() {
                throw new Error('illegal invocation')
              },
            },
            capture,
          }
        )
      ).status
    ).toBe(503)

    const brokenAuth = { get: vi.fn(async () => Promise.reject(new Error('AUTH unavailable'))) }
    expect(
      (
        await handlePostShadowChaseSettlement(
          incoming.clone(),
          { AUTH: brokenAuth as unknown as KVNamespace, COMPANION_DB: createTestDb() },
          { scheduler: collectingScheduler(), capture }
        )
      ).status
    ).toBe(500)
  })

  it('credits +5 for a win and returns the reward in the 202 body', async () => {
    const { auth, cookie } = await authenticated('user-a')
    const db = createTestDb()
    const scheduler = collectingScheduler()

    const response = await handlePostShadowChaseSettlement(
      request(body({ outcome: 'win' }), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: db },
      { scheduler, now: () => NOW }
    )

    expect(response.status).toBe(202)
    const json = (await response.json()) as { accepted: true; reward?: WinReward }
    expect(json.accepted).toBe(true)
    expect(json.reward).toEqual({
      asset_type: 'starburst',
      amount: 5,
      status: 'credited',
      balance: 5,
    })
    const row = await db
      .prepare("SELECT amount, source_key FROM asset_entry WHERE source_key GLOB 'win:*'")
      .first<{ amount: number; source_key: string }>()
    expect(row?.amount).toBe(5)
    expect(row?.source_key).toBe(`win:${settlementIdFor(SHADOW_CHASE_GAME_ID, 'user-a', RUN_ID)}`)
  })

  it('does not credit a loss and returns no reward', async () => {
    const { auth, cookie } = await authenticated('user-a')
    const db = createTestDb()

    const response = await handlePostShadowChaseSettlement(
      request(body({ outcome: 'loss' }), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: db },
      { scheduler: collectingScheduler(), now: () => NOW }
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
    const rows = await db
      .prepare("SELECT amount FROM asset_entry WHERE source_key GLOB 'win:*'")
      .all()
    expect(rows.results).toHaveLength(0)
  })

  it('derives the win source_key from the converged settlementIdFor (parity with the pre-swap local copy)', async () => {
    const { auth, cookie } = await authenticated('user-a')
    const db = createTestDb()

    await handlePostShadowChaseSettlement(
      request(body({ outcome: 'win' }), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: db },
      { scheduler: collectingScheduler(), now: () => NOW }
    )

    // The deleted handler-local settlementIdFor produced exactly this string;
    // the imported companion-memory copy must reproduce it byte-for-byte so the
    // win-reward key never drifts from what earlier runs would have written.
    const preSwapLiteral = `${SHADOW_CHASE_GAME_ID}:${'user-a'.length}:user-a:${RUN_ID}`
    expect(settlementIdFor(SHADOW_CHASE_GAME_ID, 'user-a', RUN_ID)).toBe(preSwapLiteral)
    const row = await db
      .prepare("SELECT source_key FROM asset_entry WHERE source_key GLOB 'win:*'")
      .first<{ source_key: string }>()
    expect(row?.source_key).toBe(`win:${preSwapLiteral}`)
  })

  it('keeps a win settlement successful with no reward when the ledger throws', async () => {
    const { auth, cookie } = await authenticated('user-a')
    // A ledger that throws on every statement. A no-op capture keeps the
    // failure isolated to the synchronous win credit, which is fail-open —
    // the settlement must still 202 with no reward field.
    const throwingDb = {
      prepare() {
        throw new Error('D1 unavailable')
      },
      batch() {
        return Promise.reject(new Error('D1 unavailable'))
      },
    } as unknown as CompanionDb

    const response = await handlePostShadowChaseSettlement(
      request(body({ outcome: 'win' }), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: throwingDb },
      { scheduler: collectingScheduler(), now: () => NOW, capture: async () => ({}) }
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
  })

  it('keeps a post-202 D1 rejection contained and logs only a run-scoped redacted reference', async () => {
    const { auth, cookie } = await authenticated('user-a')
    const scheduler = collectingScheduler()
    const logger = vi.fn()
    const capture = vi.fn(async () => Promise.reject(new Error('D1 partial statement failure')))
    const response = await handlePostShadowChaseSettlement(
      request(body(), { Cookie: cookie }),
      { AUTH: auth.asKV(), COMPANION_DB: createTestDb() },
      { scheduler, capture, logger, now: () => NOW }
    )

    expect(response.status).toBe(202)
    await expect(Promise.all(scheduler.promises)).resolves.toEqual([undefined])
    const logs = JSON.stringify(logger.mock.calls)
    expect(logs).toContain(RUN_ID)
    expect(logs).not.toContain('user-a')
    expect(logs).not.toContain(settlementIdFor(SHADOW_CHASE_GAME_ID, 'user-a', RUN_ID))
    expect(logs).not.toContain('D1 partial statement failure')
  })
})
