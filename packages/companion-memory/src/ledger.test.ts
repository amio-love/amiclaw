/**
 * Reward-economy ledger tests: balance aggregation over mixed +/- rows, keyset
 * pagination, idempotent replay, the win duplicate-before-cap contract, the
 * NaN-poison deduct guard, once-per-day check-in, once-ever welcome, and the
 * source-key / numeric SSOT.
 */

import { describe, expect, it } from 'vitest'
import type { CompanionDb } from './db'
import type { DomainDeps } from './deps'
import {
  ASSET_TYPE_STARBURST,
  CHECKIN_REWARD,
  DAILY_WIN_CAP,
  MIN_SESSION_BALANCE,
  STARBURST_PER_MINUTE,
  WELCOME_GRANT,
  WIN_REWARD,
} from './economy'
import {
  checkinSourceKey,
  sessionDeductSourceKey,
  settlementIdFor,
  welcomeSourceKey,
  winSourceKey,
} from './idempotency'
import {
  countTodaysRewardedWins,
  creditCheckinReward,
  creditWelcomeGrant,
  creditWinReward,
  deductSessionMinutes,
  existsBySourceKey,
  listAssetEntries,
  readBalance,
} from './ledger'
import { createTestDb } from './test-support/sqlite-db'

const NOW = '2026-07-11T10:00:00.000Z'
const TODAY = '2026-07-11'
const USER = 'user-a'

// A single monotonic id sequence across every deps instance mirrors production
// `crypto.randomUUID` uniqueness — a per-call reset would collide on the id PK.
let idSeq = 0
function testDeps(now: string = NOW): DomainDeps {
  return { now: () => now, newId: () => `id-${(idSeq += 1)}` }
}

async function seedEntry(
  db: CompanionDb,
  row: {
    id: string
    userId?: string
    assetType?: string
    amount: number
    sourceProduct?: string
    sourceRef?: string
    sourceKey: string
    earnedAt: string
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO asset_entry (id, user_id, asset_type, amount, source_product, source_ref, source_key, earned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.userId ?? USER,
      row.assetType ?? ASSET_TYPE_STARBURST,
      row.amount,
      row.sourceProduct ?? 'amiclaw',
      row.sourceRef ?? 'test',
      row.sourceKey,
      row.earnedAt
    )
    .run()
}

describe('readBalance', () => {
  it('is 0 for an empty ledger', async () => {
    const db = createTestDb()
    expect(await readBalance(db, USER)).toBe(0)
  })

  it('sums mixed positive and negative rows', async () => {
    const db = createTestDb()
    await seedEntry(db, {
      id: 'r1',
      amount: WELCOME_GRANT,
      sourceKey: 'welcome:user-a',
      earnedAt: NOW,
    })
    await seedEntry(db, { id: 'r2', amount: WIN_REWARD, sourceKey: 'win:a', earnedAt: NOW })
    await seedEntry(db, { id: 'r3', amount: -3, sourceKey: 'session:s1', earnedAt: NOW })
    // 10 + 5 - 3 = 12
    expect(await readBalance(db, USER)).toBe(12)
  })

  it('scopes to the asset type and the owner', async () => {
    const db = createTestDb()
    await seedEntry(db, { id: 'r1', amount: 10, sourceKey: 'welcome:user-a', earnedAt: NOW })
    await seedEntry(db, {
      id: 'r2',
      amount: 99,
      assetType: 'other-coin',
      sourceKey: 'x:1',
      earnedAt: NOW,
    })
    await seedEntry(db, {
      id: 'r3',
      userId: 'user-b',
      amount: 42,
      sourceKey: 'welcome:user-b',
      earnedAt: NOW,
    })
    expect(await readBalance(db, USER)).toBe(10)
  })
})

describe('listAssetEntries', () => {
  it('derives kind from the source_key prefix and never exposes id or source_ref', async () => {
    const db = createTestDb()
    await seedEntry(db, {
      id: 'r1',
      amount: 5,
      sourceKey: 'win:bombsquad:6:user-a:run1',
      earnedAt: '2026-07-11T05:00:00.000Z',
    })
    await seedEntry(db, {
      id: 'r2',
      amount: 3,
      sourceKey: 'checkin:user-a:2026-07-11',
      earnedAt: '2026-07-11T04:00:00.000Z',
    })
    await seedEntry(db, {
      id: 'r3',
      amount: 10,
      sourceKey: 'welcome:user-a',
      earnedAt: '2026-07-11T03:00:00.000Z',
    })
    await seedEntry(db, {
      id: 'r4',
      amount: -2,
      sourceKey: 'session:s1',
      earnedAt: '2026-07-11T02:00:00.000Z',
    })
    await seedEntry(db, {
      id: 'r5',
      amount: 1,
      sourceKey: 'settlement:x#asset#0',
      earnedAt: '2026-07-11T01:00:00.000Z',
    })

    const page = await listAssetEntries(db, USER, { limit: 50 })
    expect(page.entries.map((e) => e.kind)).toEqual([
      'win',
      'checkin',
      'welcome',
      'session',
      'other',
    ])
    expect(Object.keys(page.entries[0]).sort()).toEqual([
      'amount',
      'earned_at',
      'kind',
      'source_product',
    ])
  })

  it('paginates in a stable newest-first order across cursors, including earned_at ties', async () => {
    const db = createTestDb()
    // Two rows share an earned_at to exercise the (earned_at, id) tiebreak.
    const seeds = [
      { id: 'a1', earnedAt: '2026-07-11T09:00:00.000Z' },
      { id: 'a2', earnedAt: '2026-07-11T08:00:00.000Z' },
      { id: 'a3', earnedAt: '2026-07-11T08:00:00.000Z' },
      { id: 'a4', earnedAt: '2026-07-11T07:00:00.000Z' },
      { id: 'a5', earnedAt: '2026-07-11T06:00:00.000Z' },
    ]
    for (const s of seeds) {
      await seedEntry(db, { id: s.id, amount: 1, sourceKey: `win:${s.id}`, earnedAt: s.earnedAt })
    }

    const full = await listAssetEntries(db, USER, { limit: 50 })
    expect(full.entries).toHaveLength(5)
    expect(full.nextCursor).toBeUndefined()

    // Walk the same ordering two-at-a-time and assert no gap and no duplicate.
    const walked: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof listAssetEntries>> = await listAssetEntries(db, USER, {
        limit: 2,
        cursor,
      })
      walked.push(...page.entries.map((e) => e.earned_at))
      if (page.nextCursor === undefined) break
      cursor = page.nextCursor
    }
    expect(walked).toEqual(full.entries.map((e) => e.earned_at))
  })

  it('treats a malformed cursor as the first page', async () => {
    const db = createTestDb()
    await seedEntry(db, { id: 'r1', amount: 5, sourceKey: 'win:a', earnedAt: NOW })
    const page = await listAssetEntries(db, USER, { cursor: 'not-base64-json' })
    expect(page.entries).toHaveLength(1)
  })
})

describe('creditWelcomeGrant', () => {
  it('mints +10 exactly once ever', async () => {
    const db = createTestDb()
    const first = await creditWelcomeGrant(db, USER, testDeps())
    const second = await creditWelcomeGrant(db, USER, testDeps())
    expect(first.credited).toBe(true)
    expect(second.credited).toBe(false)
    expect(await readBalance(db, USER)).toBe(WELCOME_GRANT)
    expect(await existsBySourceKey(db, welcomeSourceKey(USER))).toBe(true)
  })
})

describe('creditCheckinReward', () => {
  it('credits +3 once per UTC day and no-ops on repeat', async () => {
    const db = createTestDb()
    const first = await creditCheckinReward(db, USER, TODAY, testDeps())
    const repeat = await creditCheckinReward(db, USER, TODAY, testDeps())
    expect(first).toMatchObject({ credited: true, amount: CHECKIN_REWARD, balance: CHECKIN_REWARD })
    expect(repeat).toMatchObject({ credited: false, amount: 0, balance: CHECKIN_REWARD })
  })

  it('credits again on a new UTC day', async () => {
    const db = createTestDb()
    await creditCheckinReward(db, USER, '2026-07-11', testDeps())
    const nextDay = await creditCheckinReward(db, USER, '2026-07-12', testDeps())
    expect(nextDay.credited).toBe(true)
    expect(await readBalance(db, USER)).toBe(CHECKIN_REWARD * 2)
    expect(await existsBySourceKey(db, checkinSourceKey(USER, '2026-07-12'))).toBe(true)
  })
})

describe('creditWinReward', () => {
  it('credits +5 on the first settlement of a run', async () => {
    const db = createTestDb()
    const r = await creditWinReward(db, {
      userId: USER,
      gameId: 'bombsquad',
      runId: 'run1',
      today: TODAY,
      deps: testDeps(),
    })
    expect(r).toEqual({ status: 'credited', amount: WIN_REWARD, balance: WIN_REWARD })
    expect(await existsBySourceKey(db, winSourceKey('bombsquad', USER, 'run1'))).toBe(true)
  })

  it('is idempotent per run — a replay writes no second row', async () => {
    const db = createTestDb()
    const base = { userId: USER, gameId: 'bombsquad', runId: 'run1', today: TODAY }
    await creditWinReward(db, { ...base, deps: testDeps() })
    await creditWinReward(db, { ...base, deps: testDeps() })
    expect(await readBalance(db, USER)).toBe(WIN_REWARD)
    expect(await countTodaysRewardedWins(db, USER, TODAY)).toBe(1)
  })

  it('caps at DAILY_WIN_CAP rewarded wins combined across games', async () => {
    const db = createTestDb()
    // Two bombsquad + two shadow-chase distinct runs = 4 (the cap).
    const runs = [
      { gameId: 'bombsquad', runId: 'b1' },
      { gameId: 'bombsquad', runId: 'b2' },
      { gameId: 'shadow-chase', runId: 's1' },
      { gameId: 'shadow-chase', runId: 's2' },
    ]
    for (const run of runs) {
      const r = await creditWinReward(db, { userId: USER, today: TODAY, deps: testDeps(), ...run })
      expect(r.status).toBe('credited')
    }
    const overCap = await creditWinReward(db, {
      userId: USER,
      gameId: 'bombsquad',
      runId: 'b3',
      today: TODAY,
      deps: testDeps(),
    })
    expect(overCap.status).toBe('capped')
    expect(overCap.amount).toBe(0)
    expect(await readBalance(db, USER)).toBe(WIN_REWARD * DAILY_WIN_CAP)
  })

  it('returns duplicate (not capped) when an already-rewarded run replays after the cap is reached', async () => {
    const db = createTestDb()
    const runs = ['r1', 'r2', 'r3', 'r4']
    for (const runId of runs) {
      await creditWinReward(db, {
        userId: USER,
        gameId: 'bombsquad',
        runId,
        today: TODAY,
        deps: testDeps(),
      })
    }
    // Cap is now reached. Replaying the FIRST run must resolve as duplicate,
    // proving the duplicate lookup runs before the cap check.
    const replay = await creditWinReward(db, {
      userId: USER,
      gameId: 'bombsquad',
      runId: 'r1',
      today: TODAY,
      deps: testDeps(),
    })
    expect(replay.status).toBe('duplicate')
  })

  it('counts only wins within the UTC day for the cap window', async () => {
    const db = createTestDb()
    await seedEntry(db, {
      id: 'y1',
      amount: 5,
      sourceKey: 'win:x1',
      earnedAt: '2026-07-10T23:59:59.000Z',
    })
    await seedEntry(db, {
      id: 't1',
      amount: 5,
      sourceKey: 'win:x2',
      earnedAt: '2026-07-11T00:00:00.000Z',
    })
    await seedEntry(db, {
      id: 't2',
      amount: 5,
      sourceKey: 'win:x3',
      earnedAt: '2026-07-11T23:59:59.999Z',
    })
    await seedEntry(db, {
      id: 'm1',
      amount: 5,
      sourceKey: 'win:x4',
      earnedAt: '2026-07-12T00:00:00.000Z',
    })
    // Only the two 2026-07-11 rows count.
    expect(await countTodaysRewardedWins(db, USER, TODAY)).toBe(2)
  })
})

describe('deductSessionMinutes', () => {
  it('writes one negative row for a positive-integer minute count', async () => {
    const db = createTestDb()
    await creditWelcomeGrant(db, USER, testDeps())
    const r = await deductSessionMinutes(db, {
      userId: USER,
      sessionId: 's1',
      minutes: 3,
      fundingSource: 'earned',
      deps: testDeps(),
    })
    expect(r).toEqual({ deducted: true, amount: -3 })
    expect(await readBalance(db, USER)).toBe(WELCOME_GRANT - 3)
    expect(await existsBySourceKey(db, sessionDeductSourceKey('s1'))).toBe(true)
  })

  it('is idempotent per session — a double teardown writes no second row', async () => {
    const db = createTestDb()
    await creditWelcomeGrant(db, USER, testDeps())
    await deductSessionMinutes(db, {
      userId: USER,
      sessionId: 's1',
      minutes: 2,
      fundingSource: 'earned',
      deps: testDeps(),
    })
    const again = await deductSessionMinutes(db, {
      userId: USER,
      sessionId: 's1',
      minutes: 2,
      fundingSource: 'earned',
      deps: testDeps(),
    })
    expect(again.deducted).toBe(false)
    expect(await readBalance(db, USER)).toBe(WELCOME_GRANT - 2)
  })

  it('REFUSES non-finite / non-positive / non-integer minutes and leaves the balance unpoisoned', async () => {
    const db = createTestDb()
    await creditWelcomeGrant(db, USER, testDeps())
    const before = await readBalance(db, USER)
    for (const bad of [NaN, Infinity, -Infinity, 0, -5, 1.5]) {
      const r = await deductSessionMinutes(db, {
        userId: USER,
        sessionId: `bad-${bad}`,
        minutes: bad,
        fundingSource: 'earned',
        deps: testDeps(),
      })
      expect(r).toEqual({ deducted: false, amount: 0 })
    }
    const after = await readBalance(db, USER)
    expect(after).toBe(before)
    expect(Number.isFinite(after)).toBe(true)
    // No session rows were written by the refused attempts.
    const page = await listAssetEntries(db, USER, { limit: 50 })
    expect(page.entries.some((e) => e.kind === 'session')).toBe(false)
  })
})

describe('source keys', () => {
  it('derives a colon-safe settlement id with a length prefix', () => {
    expect(settlementIdFor('bombsquad', 'user-a', 'run1')).toBe('bombsquad:6:user-a:run1')
    expect(winSourceKey('bombsquad', 'user-a', 'run1')).toBe('win:bombsquad:6:user-a:run1')
    expect(checkinSourceKey('user-a', '2026-07-11')).toBe('checkin:user-a:2026-07-11')
    expect(welcomeSourceKey('user-a')).toBe('welcome:user-a')
    expect(sessionDeductSourceKey('sess-1')).toBe('session:sess-1')
  })
})

describe('economy constants', () => {
  it('pins the reward-economy numeric SSOT', () => {
    expect(ASSET_TYPE_STARBURST).toBe('starburst')
    expect(WIN_REWARD).toBe(5)
    expect(CHECKIN_REWARD).toBe(3)
    expect(WELCOME_GRANT).toBe(10)
    expect(DAILY_WIN_CAP).toBe(4)
    expect(STARBURST_PER_MINUTE).toBe(1)
    expect(MIN_SESSION_BALANCE).toBe(1)
  })
})
