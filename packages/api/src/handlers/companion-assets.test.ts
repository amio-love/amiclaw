/**
 * HTTP-semantics tests for GET /api/companion/assets (reward-economy balance +
 * ledger read; L2 design §2 + §6 welcome grant, endpoint side), run against the
 * REAL schema (node:sqlite adapter) and the FakeKV session store.
 *
 * Pinned here (acceptance criteria):
 *  - unauthenticated -> 401 (require-session gate);
 *  - the welcome grant mints EXACTLY once: +10 with welcome_granted true on the
 *    first read, then absent/no-op on every later read;
 *  - balance is the SUM over a mix of positive credits and negative deducts;
 *  - the keyset cursor round-trips a full ledger with no overlap or gap;
 *  - a request-supplied user_id never becomes the owner (session identity wins);
 *  - the entries DTO exposes no internal `id` (it lives only in the cursor).
 */

import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../companion-memory/src/test-support/sqlite-db'
import type { CompanionDb } from '../../../companion-memory/src/db'
import type { DomainDeps } from '../../../companion-memory/src/deps'
import {
  creditCheckinReward,
  creditWelcomeGrant,
  creditWinReward,
  deductSessionMinutes,
} from '../../../companion-memory/src/ledger'
import { FakeKV } from '../auth/fake-kv'
import type { CompanionApiEnv } from './companion-shared'
import { handleGetCompanionAssets } from './companion-assets'

const NOW = '2026-06-11T10:00:00.000Z'
const TODAY = '2026-06-11'

async function makeEnv(): Promise<{ env: CompanionApiEnv; db: CompanionDb }> {
  const kv = new FakeKV()
  await kv.put(
    'session:sess-a',
    JSON.stringify({ user_id: 'user-a', email: 'a@example.com', created_at: NOW })
  )
  const db = createTestDb()
  return { env: { AUTH: kv.asKV(), COMPANION_DB: db }, db }
}

function authedRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://claw.amio.fans${path}`, {
    ...init,
    headers: { Cookie: 'amiclaw_session=sess-a', ...(init.headers ?? {}) },
  })
}

function anonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://claw.amio.fans${path}`, init)
}

/**
 * Deterministic clock: each ledger write gets a strictly-later `earned_at`, so
 * insertion order equals chronological order (and the newest-first list is the
 * exact reverse). Ids are a stable counter, decoupled from the clock.
 */
function makeSeqDeps(): DomainDeps {
  let idN = 0
  let tsN = 0
  const base = Date.parse(NOW)
  return {
    newId: () => `id-${(idN++).toString().padStart(4, '0')}`,
    now: () => new Date(base + tsN++ * 1000).toISOString(),
  }
}

interface AssetEntry {
  amount: number
  source_product: string
  kind: string
  earned_at: string
}

interface AssetsBody {
  asset_type: string
  balance: number
  entries: AssetEntry[]
  next_cursor?: string
  welcome_granted?: boolean
}

/**
 * Seed a mixed ledger for `user-a`: +10 welcome, +5 win, +3 checkin, -2 session
 * (balance 16). Written oldest->newest, so newest-first reads back as
 * session, checkin, win, welcome.
 */
async function seedMixedLedger(db: CompanionDb): Promise<void> {
  const deps = makeSeqDeps()
  await creditWelcomeGrant(db, 'user-a', deps)
  await creditWinReward(db, {
    userId: 'user-a',
    gameId: 'bombsquad',
    runId: 'r1',
    today: TODAY,
    deps,
  })
  await creditCheckinReward(db, 'user-a', TODAY, deps)
  await deductSessionMinutes(db, {
    userId: 'user-a',
    sessionId: 's1',
    minutes: 2,
    fundingSource: 'earned',
    deps,
  })
}

describe('GET /api/companion/assets — require-session gate', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const { env } = await makeEnv()
    const response = await handleGetCompanionAssets(anonRequest('/api/companion/assets'), env)
    expect(response.status).toBe(401)
  })
})

describe('GET /api/companion/assets — welcome grant (mints exactly once)', () => {
  it('mints +10 with welcome_granted true on the first read, then no-ops', async () => {
    const { env } = await makeEnv()

    const first = await handleGetCompanionAssets(authedRequest('/api/companion/assets'), env)
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('no-store')
    const firstBody = (await first.json()) as AssetsBody
    expect(firstBody.welcome_granted).toBe(true)
    expect(firstBody.balance).toBe(10)
    expect(firstBody.asset_type).toBe('starburst')
    expect(firstBody.entries.map((e) => e.kind)).toEqual(['welcome'])

    const second = await handleGetCompanionAssets(authedRequest('/api/companion/assets'), env)
    const secondBody = (await second.json()) as AssetsBody
    // The flag is present ONLY on the minting request.
    expect(secondBody.welcome_granted).toBeUndefined()
    // Still exactly one welcome row — the grant did not double-mint.
    expect(secondBody.balance).toBe(10)
    expect(secondBody.entries).toHaveLength(1)
  })
})

describe('GET /api/companion/assets — balance over mixed entries', () => {
  it('sums positive credits and negative deducts, newest first', async () => {
    const { env, db } = await makeEnv()
    await seedMixedLedger(db)

    const response = await handleGetCompanionAssets(authedRequest('/api/companion/assets'), env)
    expect(response.status).toBe(200)
    const body = (await response.json()) as AssetsBody

    // Welcome was pre-seeded, so the endpoint mint no-ops (no flag).
    expect(body.welcome_granted).toBeUndefined()
    expect(body.balance).toBe(16) // 10 + 5 + 3 - 2
    expect(body.entries.map((e) => e.kind)).toEqual(['session', 'checkin', 'win', 'welcome'])
    expect(body.entries.map((e) => e.amount)).toEqual([-2, 3, 5, 10])
  })
})

describe('GET /api/companion/assets — keyset pagination round-trip', () => {
  it('walks the full ledger via next_cursor with no overlap or gap', async () => {
    const { env, db } = await makeEnv()
    await seedMixedLedger(db) // 4 entries

    const page1 = await handleGetCompanionAssets(
      authedRequest('/api/companion/assets?limit=2'),
      env
    )
    const body1 = (await page1.json()) as AssetsBody
    expect(body1.entries.map((e) => e.kind)).toEqual(['session', 'checkin'])
    expect(body1.next_cursor).toBeDefined()

    const page2 = await handleGetCompanionAssets(
      authedRequest(
        `/api/companion/assets?limit=2&cursor=${encodeURIComponent(body1.next_cursor as string)}`
      ),
      env
    )
    const body2 = (await page2.json()) as AssetsBody
    expect(body2.entries.map((e) => e.kind)).toEqual(['win', 'welcome'])
    // Last page — no further cursor.
    expect(body2.next_cursor).toBeUndefined()
  })
})

describe('GET /api/companion/assets — owner is server-derived', () => {
  it('ignores a request-supplied user_id and returns the session user balance', async () => {
    const { env, db } = await makeEnv()
    await seedMixedLedger(db) // user-a -> balance 16
    // A DIFFERENT user with a different balance — must never leak through.
    await creditWelcomeGrant(db, 'user-b') // user-b -> balance 10

    const response = await handleGetCompanionAssets(
      authedRequest('/api/companion/assets?user_id=user-b'),
      env
    )
    const body = (await response.json()) as AssetsBody
    expect(body.balance).toBe(16) // user-a (session), not user-b (10)
  })
})

describe('GET /api/companion/assets — entries DTO shape', () => {
  it('never exposes the internal row id', async () => {
    const { env, db } = await makeEnv()
    await seedMixedLedger(db)

    const response = await handleGetCompanionAssets(authedRequest('/api/companion/assets'), env)
    const body = (await response.json()) as AssetsBody
    expect(body.entries.length).toBeGreaterThan(0)
    for (const entry of body.entries) {
      expect(entry).not.toHaveProperty('id')
      expect(entry).not.toHaveProperty('source_ref')
      expect(entry).not.toHaveProperty('source_key')
      expect(Object.keys(entry).sort()).toEqual(['amount', 'earned_at', 'kind', 'source_product'])
    }
  })
})
