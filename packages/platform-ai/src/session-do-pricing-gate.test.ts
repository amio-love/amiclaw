import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class tests for `VoiceSessionDO`'s reward-economy session pricing
 * gate (L2 design §5 / §6.2), driving the REAL `VoiceSessionDO` under the workerd
 * runtime (`@cloudflare/vitest-pool-workers`) — the same harness the usage-flush /
 * end-cleanup / epoch-guard suites use.
 *
 * The pure ledger core (`readBalance` / `creditWelcomeGrant` / `deductSessionMinutes`
 * SQL, the source-key idempotency, the NaN-poison refusal) is owned by the
 * companion-memory unit tests. These tests own the DO's WIRING of that core:
 *  - the create-branch pricing gate (welcome-mint → readBalance → admit / refuse);
 *  - `finalizeSessionAccounting`'s single-`deductFlushed` guard across `endSession`
 *    + the owner-socket close;
 *  - the billed-minutes floor(1)/cap(budget) arithmetic and the non-finite
 *    `startedAtMs` skip (the NaN-poison invariant at the DO boundary);
 *  - the burn-through wind-down TIMER actually FIRING in workerd (the §11.iv L3
 *    obligation) and driving the wind-down recap + teardown + depletion summary.
 *
 * D1 seam: the test-only `wrangler.vitest.toml` deliberately OMITS `COMPANION_DB`
 * (memory-less by default), so the gate is skipped for every other suite. Here we
 * inject a `FakeCompanionDb` — an in-memory `asset_entry` ledger that runs the
 * REAL ledger SQL (SUM balance, `ON CONFLICT (source_key)` idempotent inserts) —
 * into `instance.env.COMPANION_DB` via the `handle.run` seam, exactly as the
 * usage-flush suite injects a USAGE KV double. So these tests exercise the genuine
 * `ledger.ts` code path, not a mock of it.
 */

import type {
  CompanionDb,
  CompanionDbRunResult,
  CompanionDbStatement,
} from '../../companion-memory/src/db'
import type { SessionDoEnv } from './session-do'
import type { VoiceSessionDO } from './session-do'
import {
  createSessionOverWs,
  MANUAL,
  makeSessionDo,
  messagesOfType,
  openSocket,
  settle,
  waitFor,
  waitForMessage,
  type SessionHandle,
  type TestSocket,
} from './session-do-test-kit'

// --- in-memory ledger double ------------------------------------------------------

interface LedgerRow {
  id: string
  user_id: string
  asset_type: string
  amount: number
  source_product: string
  source_ref: string
  source_key: string
  earned_at: string
}

/** Fixed `asset_entry` column order both ledger inserts bind against. */
const INSERT_COLUMNS = [
  'id',
  'user_id',
  'asset_type',
  'amount',
  'source_product',
  'source_ref',
  'source_key',
  'earned_at',
] as const

/**
 * A minimal in-memory `CompanionDb` that faithfully executes the exact statements
 * the DO's pricing-gate path issues through `ledger.ts`:
 *  - `SELECT COALESCE(SUM(amount), 0) AS balance ...` (readBalance);
 *  - `INSERT INTO asset_entry (...) VALUES (...) ON CONFLICT (source_key) DO NOTHING`
 *    (creditWelcomeGrant + deductSessionMinutes), with real source-key uniqueness.
 * Every other read (the companion-context resolver at create) returns empty, so a
 * session degrades to memory-less exactly as it would with no companion rows.
 */
class FakeCompanionDb implements CompanionDb {
  readonly rows: LedgerRow[] = []

  /** Seed a row directly (test setup — pre-existing ledger state). */
  seed(row: Omit<LedgerRow, 'id'> & { id?: string }): void {
    this.rows.push({ id: row.id ?? crypto.randomUUID(), ...row })
  }

  balanceOf(userId: string, assetType = 'starburst'): number {
    return this.rows
      .filter((r) => r.user_id === userId && r.asset_type === assetType)
      .reduce((sum, r) => sum + r.amount, 0)
  }

  /** Negative session-deduct rows (`source_key = session:{sessionId}`). */
  deductRows(): LedgerRow[] {
    return this.rows.filter((r) => r.source_key.startsWith('session:'))
  }

  /** Welcome-grant rows (`source_key = welcome:{userId}`). */
  welcomeRows(): LedgerRow[] {
    return this.rows.filter((r) => r.source_key.startsWith('welcome:'))
  }

  prepare(sql: string): CompanionDbStatement {
    return new FakeStatement(this, sql)
  }

  async batch(statements: CompanionDbStatement[]): Promise<CompanionDbRunResult[]> {
    const out: CompanionDbRunResult[] = []
    for (const statement of statements) out.push(await statement.run())
    return out
  }

  // --- statement executors (called by FakeStatement) ---

  execFirst(sql: string, values: unknown[]): unknown {
    if (sql.includes('COALESCE(SUM(amount)')) {
      const [userId, assetType] = values as [string, string]
      return { balance: this.balanceOf(userId, assetType) }
    }
    // Any other read (companion-context resolver) sees no rows.
    return null
  }

  execRun(sql: string, values: unknown[]): CompanionDbRunResult {
    if (!sql.includes('INSERT INTO asset_entry')) return { meta: { changes: 0 } }
    const row = this.buildInsertRow(sql, values)
    if (this.rows.some((r) => r.source_key === row.source_key)) {
      // ON CONFLICT (source_key) DO NOTHING — idempotent no-op.
      return { meta: { changes: 0 } }
    }
    this.rows.push(row)
    return { meta: { changes: 1 } }
  }

  /**
   * Map a `VALUES (...)` tuple to a row: positional against `INSERT_COLUMNS`,
   * taking the next bind for each `?` and stripping quotes for a SQL literal.
   * The two ledger inserts share the column list and differ only in which cells
   * are bound vs literal (welcome hardcodes `'welcome'`; deduct binds source_ref).
   */
  private buildInsertRow(sql: string, values: unknown[]): LedgerRow {
    const open = sql.indexOf('(', sql.indexOf('VALUES ('))
    const close = sql.indexOf(')', open)
    const tokens = sql
      .slice(open + 1, close)
      .split(',')
      .map((t) => t.trim())
    const row: Record<string, unknown> = {}
    let bindPos = 0
    tokens.forEach((token, i) => {
      const column = INSERT_COLUMNS[i]
      row[column] = token === '?' ? values[bindPos++] : token.replace(/^'|'$/g, '')
    })
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      asset_type: String(row.asset_type),
      amount: Number(row.amount),
      source_product: String(row.source_product),
      source_ref: String(row.source_ref),
      source_key: String(row.source_key),
      earned_at: String(row.earned_at),
    }
  }
}

class FakeStatement implements CompanionDbStatement {
  private values: unknown[] = []

  constructor(
    private readonly db: FakeCompanionDb,
    private readonly sql: string
  ) {}

  bind(...values: unknown[]): CompanionDbStatement {
    this.values = values
    return this
  }

  run(): Promise<CompanionDbRunResult> {
    return Promise.resolve(this.db.execRun(this.sql, this.values))
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.db.execFirst(this.sql, this.values) as T | null)
  }

  all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({ results: [] as T[] })
  }
}

/** A `CompanionDb` whose every statement rejects — the gate's fail-open probe. */
class ThrowingCompanionDb implements CompanionDb {
  prepare(): CompanionDbStatement {
    const fail = (): Promise<never> => Promise.reject(new Error('d1 unavailable'))
    const statement: CompanionDbStatement = {
      bind: () => statement,
      run: fail,
      first: fail,
      all: fail,
    }
    return statement
  }
  batch(): Promise<CompanionDbRunResult[]> {
    return Promise.reject(new Error('d1 unavailable'))
  }
}

// --- private-surface views (cast, mirroring the usage-flush suite's env cast) -----

interface DoPrivate {
  env: SessionDoEnv
  burnMinuteMs: number
  sessionState: { startedAtMs: number; budgetMinutes?: number } | undefined
}

function asPrivate(instance: VoiceSessionDO): DoPrivate {
  return instance as unknown as DoPrivate
}

/** Merge a `COMPANION_DB` into the DO's real workerd env (keep USAGE et al.). */
async function injectCompanionDb(handle: SessionHandle, db: CompanionDb): Promise<void> {
  await handle.run((instance) => {
    const view = asPrivate(instance)
    view.env = { ...view.env, COMPANION_DB: db } as SessionDoEnv
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

// --- create-gate: refuse / admit / priceless --------------------------------------

describe('VoiceSessionDO pricing gate — create branch', () => {
  it('refuses a balance-0 open with a structured insufficient_balance frame + 1000 close, never assembling', async () => {
    const db = new FakeCompanionDb()
    // Welcome already granted (mint no-ops) and fully spent → balance 0.
    db.seed({
      user_id: 'user-A',
      asset_type: 'starburst',
      amount: 10,
      source_product: 'amiclaw',
      source_ref: 'welcome',
      source_key: 'welcome:user-A',
      earned_at: '2026-07-01T00:00:00.000Z',
    })
    db.seed({
      user_id: 'user-A',
      asset_type: 'starburst',
      amount: -10,
      source_product: 'amiclaw',
      source_ref: 'session:earned',
      source_key: 'session:prior',
      earned_at: '2026-07-01T00:01:00.000Z',
    })
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')
    const deductsBefore = db.deductRows().length // the seeded prior spend

    socket.send(
      JSON.stringify({ type: 'create', gameId: 'demo-mock', manualData: MANUAL, opening: false })
    )
    await waitFor(() => socket.messagesOfType('error').length > 0, 'insufficient_balance frame')

    const error = socket.messagesOfType('error')[0]
    expect(error.code).toBe('insufficient_balance')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean 1000 close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'insufficient balance' })

    // The session never assembled: no `created` ack, no bound state, no deduct.
    expect(socket.messagesOfType('created')).toHaveLength(0)
    const assembled = await handle.run((instance) => asPrivate(instance).sessionState !== undefined)
    expect(assembled).toBe(false)
    // The rejected create ran no accounting: no NEW deduct beyond the seeded spend.
    expect(db.deductRows()).toHaveLength(deductsBefore)
    // The welcome mint was a no-op (already granted): still exactly one welcome row.
    expect(db.welcomeRows()).toHaveLength(1)
    expect(db.balanceOf('user-A')).toBe(0)
  })

  it('mints the welcome grant for a brand-new user (0 → +10) then ADMITS with budgetMinutes = 10', async () => {
    const db = new FakeCompanionDb() // empty ledger — a first-ever user
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')

    const sessionId = await createSessionOverWs(socket)

    // The gate minted +10 before the balance read, so the session opened.
    expect(sessionId).not.toBe('')
    expect(db.welcomeRows()).toHaveLength(1)
    expect(db.welcomeRows()[0].amount).toBe(10)
    expect(db.balanceOf('user-A')).toBe(10)
    const budgetMinutes = await handle.run(
      (instance) => asPrivate(instance).sessionState?.budgetMinutes
    )
    expect(budgetMinutes).toBe(10)

    // Tear down so the (default 60 000 ms/min) burn timer is cleared.
    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')
  })

  it('skips the gate entirely for a dev/demo DO with no COMPANION_DB binding (priceless, uncapped)', async () => {
    // No injection: `wrangler.vitest.toml` binds no COMPANION_DB → Infinity budget.
    const handle = makeSessionDo()
    const socket = await openSocket(handle, 'user-A')

    const sessionId = await createSessionOverWs(socket)
    expect(sessionId).not.toBe('')

    const state = await handle.run((instance) => {
      const s = asPrivate(instance).sessionState
      return { assembled: s !== undefined, budgetMinutes: s?.budgetMinutes }
    })
    expect(state.assembled).toBe(true)
    // A priceless session is uncapped: no budgetMinutes threaded, no timer armed.
    expect(state.budgetMinutes).toBeUndefined()
  })

  it('admits fail-open (priceless) when the D1 read throws inside the gate', async () => {
    const handle = makeSessionDo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await injectCompanionDb(handle, new ThrowingCompanionDb())
    const socket = await openSocket(handle, 'user-A')

    const sessionId = await createSessionOverWs(socket)
    expect(sessionId).not.toBe('')
    const budgetMinutes = await handle.run(
      (instance) => asPrivate(instance).sessionState?.budgetMinutes
    )
    // Fail-open → Infinity → no cap threaded (a D1 failure never blocks a session).
    expect(budgetMinutes).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

// --- finalizeSessionAccounting: single deduct across both terminal paths -----------

describe('VoiceSessionDO pricing gate — finalizeSessionAccounting', () => {
  it('writes exactly ONE negative row when an end message is followed by the owner-socket close', async () => {
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'clean close')
    // The owner-socket close event the runtime fires AFTER the 1000 must not
    // double-deduct: `clearSession` unbound the owner, so `onSocketClose` bails.
    await settle()

    await waitFor(() => db.deductRows().length === 1, 'one deduct row')
    expect(db.deductRows()).toHaveLength(1)
    const deduct = db.deductRows()[0]
    expect(deduct.source_key).toBe(`session:${sessionId}`)
    expect(deduct.source_ref).toBe('session:earned') // v1 funding source
    expect(deduct.amount).toBeLessThan(0)
  })

  it('stays guarded across a repeated direct endSession — one deduct row', async () => {
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)

    await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL, undefined, {
        budgetMinutes: 10,
      })
      // `endSession` does not clear the session, so a second direct call passes
      // the state checks; the `deductFlushed` guard must absorb it.
      instance.endSession(sid, 'user-A')
      instance.endSession(sid, 'user-A')
    })

    await waitFor(() => db.deductRows().length === 1, 'one deduct row')
    expect(db.deductRows()).toHaveLength(1)
  })

  it('floors the billed minutes at 1 for an immediately-ended session', async () => {
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)

    await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL, undefined, {
        budgetMinutes: 10,
      })
      instance.endSession(sid, 'user-A')
    })

    await waitFor(() => db.deductRows().length === 1, 'one deduct row')
    expect(db.deductRows()[0].amount).toBe(-1)
  })

  it('caps the billed minutes at budgetMinutes when elapsed exceeds the budget', async () => {
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)

    await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL, undefined, {
        budgetMinutes: 2,
      })
      // Backdate the start 5 minutes: elapsed(5) > budget(2) → billed capped at 2.
      const view = asPrivate(instance)
      if (view.sessionState) view.sessionState.startedAtMs = Date.now() - 5 * 60_000
      instance.endSession(sid, 'user-A')
    })

    await waitFor(() => db.deductRows().length === 1, 'one deduct row')
    expect(db.deductRows()[0].amount).toBe(-2)
  })

  it('writes NO deduct row for a non-finite startedAtMs (NaN-poison invariant)', async () => {
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)

    await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL, undefined, {
        budgetMinutes: 10,
      })
      const view = asPrivate(instance)
      if (view.sessionState) view.sessionState.startedAtMs = Number.NaN
      instance.endSession(sid, 'user-A')
    })

    await settle()
    // A NaN amount would permanently poison SUM(amount): the DO refuses to write.
    expect(db.deductRows()).toHaveLength(0)
  })
})

// --- burn-through wind-down: the timer actually fires (§11.iv L3 obligation) -------

describe('VoiceSessionDO pricing gate — burn-through wind-down timer', () => {
  it('fires the WS-resident setTimeout, runs the wind-down recap, deducts, and closes with a balance-depleted summary', async () => {
    const db = new FakeCompanionDb() // fresh user → welcome +10 → budget 10 minutes
    const handle = makeSessionDo()
    // Shrink the per-minute wall-clock basis BEFORE `create` reads it: the real
    // `setTimeout(budgetMinutes * burnMinuteMs)` then fires after ~10 * 10 = 100 ms,
    // exercising the genuine burn-through timer (no fake timers) deterministically.
    await handle.run((instance) => {
      const view = asPrivate(instance)
      view.env = { ...view.env, COMPANION_DB: db } as SessionDoEnv
      view.burnMinuteMs = 10
    })
    const socket: TestSocket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    // The timer fires on its own — wait for the depletion summary (no client `end`).
    await waitFor(() => socket.messagesOfType('summary').length > 0, 'burn-through summary', 4000)

    // The wind-down ran ONE recap turn (LLM+TTS over demo-mock) before teardown.
    const textChunks = messagesOfType(socket, 'chunk').filter(
      (c) => c.kind === 'text' && c.text !== ''
    )
    expect(textChunks.length).toBeGreaterThan(0)

    // The terminal summary carries the depletion reason, and the socket closed 1000.
    const summary = socket.messagesOfType('summary')[0]
    expect(summary.reason).toBe('balance-depleted')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'depletion close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'balance depleted' })

    // Exactly one deduct row was written for the burned-through session.
    await waitFor(() => db.deductRows().length === 1, 'one deduct row')
    expect(db.deductRows()).toHaveLength(1)
    expect(db.deductRows()[0].source_key).toBe(`session:${sessionId}`)
    expect(db.deductRows()[0].amount).toBeLessThan(0)
  })
})
