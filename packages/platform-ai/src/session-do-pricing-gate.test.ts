import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
 *
 * The burn-through wind-down CONCURRENCY block additionally installs the gated
 * provider bundle at the `createProviders` seam (same passthrough `vi.mock` the
 * epoch-guard / turn-guard suites use), so a reply or the wind-down recap can be
 * PARKED at a genuinely pending provider `await` while a control message (the
 * budget timer firing, a barge-in) interleaves. When `providerControl.override`
 * is undefined (the default, reset per test) `createProviders` falls through to
 * the real demo-mock providers, so every other test keeps the real path.
 */

const providerControl = vi.hoisted(() => ({
  override: undefined as import('./turn-pipeline').TurnProviders | undefined,
}))

vi.mock('./providers/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/factory')>()
  return {
    ...actual,
    createProviders: (...args: Parameters<typeof actual.createProviders>) =>
      providerControl.override ?? actual.createProviders(...args),
  }
})

import { runDurableObjectAlarm } from 'cloudflare:test'
import type {
  CompanionDb,
  CompanionDbRunResult,
  CompanionDbStatement,
} from '../../companion-memory/src/db'
import type { SessionDoEnv } from './session-do'
import type { VoiceSessionDO } from './session-do'
import {
  createSessionOverWs,
  driveUtteranceToLlm,
  makeGatedProviders,
  makeStuckLlm,
  makeTurnProviders,
  MANUAL,
  makeSessionDo,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  settle,
  SPEECH_START,
  TURN,
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
  /** When true, every statement throws — a transient D1 outage the test toggles. */
  failReads = false

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
    if (this.failReads) throw new Error('transient d1 outage')
    if (sql.includes('COALESCE(SUM(amount)')) {
      const [userId, assetType] = values as [string, string]
      return { balance: this.balanceOf(userId, assetType) }
    }
    // Any other read (companion-context resolver) sees no rows.
    return null
  }

  execRun(sql: string, values: unknown[]): CompanionDbRunResult {
    if (this.failReads) throw new Error('transient d1 outage')
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
  burnSecondsPerMinute: number
  burnScheduleId: unknown
  maxTurnMs: number
  hasDeliveredTurn: boolean
  pendingWindDown: unknown
  turnInFlight: boolean
  activeTurn: unknown
  sessionState:
    | {
        startedAtMs: number
        budgetMinutes?: number
        turnGeneration: number
        turnCount: number
        history: unknown[]
      }
    | undefined
}

/** The burn-through alarm payload the DO's `schedule()` persists + dispatches. */
interface BurnPayload {
  sessionId: string
  userId: string
  budgetMinutes: number
  fundingSource: string
}

/**
 * Invoke the burn-through alarm callback the way the Agents-SDK alarm dispatch
 * would, inside the DO's I/O context. Directly exercises the FIX 1 callback
 * (resident wind-down vs. durable eviction-path deduct) deterministically —
 * without racing a 1-second-granularity wall-clock schedule.
 */
function fireBurnAlarm(handle: SessionHandle, payload: BurnPayload): Promise<void> {
  return handle.run((instance) => instance.onBurnThroughAlarm(payload))
}

/**
 * Poll a predicate over the DO's PRIVATE state (read inside its I/O context via
 * `handle.run`) until it holds — the async-DO-state analog of `waitFor` (which
 * only reads synchronous client-socket state). Lets a test synchronize on
 * "the reply parked at the stuck LLM" / "the wind-down deferred" without a sleep.
 */
async function waitForDoState(
  handle: SessionHandle,
  predicate: (view: DoPrivate) => boolean,
  label: string,
  budgetMs = 2000
): Promise<void> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (await handle.run((instance) => predicate(asPrivate(instance)))) return
    if (Date.now() > deadline) throw new Error(`waitForDoState timed out: ${label}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
}

function asPrivate(instance: VoiceSessionDO): DoPrivate {
  return instance as unknown as DoPrivate
}

beforeEach(() => {
  // Default to the real demo-mock providers; the concurrency tests opt in to the
  // gated bundle explicitly.
  providerControl.override = undefined
})

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
    // The session delivered its opening turn (FIX 3 floor gate); this suite creates
    // with the greeting off, so latch the flag directly to represent a normal
    // established session that DID deliver.
    await handle.run((instance) => {
      asPrivate(instance).hasDeliveredTurn = true
    })

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
      asPrivate(instance).hasDeliveredTurn = true // delivered a turn (FIX 3 floor gate)
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
      asPrivate(instance).hasDeliveredTurn = true // delivered a turn (FIX 3 floor gate)
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
      view.hasDeliveredTurn = true // delivered a turn (FIX 3 floor gate)
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
      // Delivered a turn, so the NaN guard (not the FIX 3 floor gate) is what skips.
      view.hasDeliveredTurn = true
      if (view.sessionState) view.sessionState.startedAtMs = Number.NaN
      instance.endSession(sid, 'user-A')
    })

    await settle()
    // A NaN amount would permanently poison SUM(amount): the DO refuses to write.
    expect(db.deductRows()).toHaveLength(0)
  })

  it('writes NO deduct row when the gate read threw (priceless admit) even if D1 recovers by teardown', async () => {
    // Gate/deduct fail-open SYMMETRY (F2): COMPANION_DB is bound, but the balance
    // read transiently throws at create → the session is admitted priceless (no
    // budgetMinutes). If D1 recovers by teardown, the deduct must STILL write
    // nothing — never bill the uncapped full elapsed for a session priced at zero.
    const db = new FakeCompanionDb()
    db.failReads = true // transient outage during the create-gate read
    const handle = makeSessionDo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')

    const sessionId = await createSessionOverWs(socket)
    // Admitted priceless: no budget threaded.
    const budgetMinutes = await handle.run(
      (instance) => asPrivate(instance).sessionState?.budgetMinutes
    )
    expect(budgetMinutes).toBeUndefined()

    // D1 recovers, and the session ran long enough that an UNCAPPED elapsed would
    // be a large charge — the fix must skip it entirely.
    db.failReads = false
    await handle.run((instance) => {
      const view = asPrivate(instance)
      // Delivered a turn, so the missing-budget guard (not the FIX 3 floor gate) is
      // what skips — the fail-open symmetry is what this test isolates.
      view.hasDeliveredTurn = true
      if (view.sessionState) view.sessionState.startedAtMs = Date.now() - 90 * 60_000
    })

    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')
    await settle()

    expect(sessionId).not.toBe('')
    expect(db.deductRows()).toHaveLength(0) // fail-open, symmetric with the gate
    expect(warn).toHaveBeenCalled()
  })

  it('FIX 3 — bills ZERO for a session that ended before any turn delivered output', async () => {
    // The opening-greeting-failure floor skip: a session that established but never
    // delivered a single turn's output (the greeting is off here, and no player turn
    // ran) is charged NOTHING — not even the 1-minute floor. `hasDeliveredTurn` stays
    // false, so `finalizeSessionAccounting` skips the deduct entirely.
    const db = new FakeCompanionDb() // fresh user → welcome +10 → budget 10
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket) // opening greeting OFF (default)

    // No turn ever delivered a chunk.
    const delivered = await handle.run((instance) => asPrivate(instance).hasDeliveredTurn)
    expect(delivered).toBe(false)

    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')
    await settle()

    expect(sessionId).not.toBe('')
    // Zero-value session → ZERO deduct (no 1-minute floor).
    expect(db.deductRows()).toHaveLength(0)
  })

  it('FIX 3 — bills the 1-minute floor once a delivered greeting flipped the flag', async () => {
    // The counterpart: a session whose opening greeting DID deliver output bills the
    // floor. Modeled by latching `hasDeliveredTurn` (the greeting's first chunk does
    // this in production) before an immediate end.
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)

    await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL, undefined, {
        budgetMinutes: 10,
      })
      asPrivate(instance).hasDeliveredTurn = true // a greeting delivered its first chunk
      instance.endSession(sid, 'user-A')
    })

    await waitFor(() => db.deductRows().length === 1, 'floor billed')
    expect(db.deductRows()).toHaveLength(1)
    expect(db.deductRows()[0].amount).toBe(-1) // the 1-minute floor
  })
})

// --- burn-through wind-down: the timer actually fires (§11.iv L3 obligation) -------

describe('VoiceSessionDO pricing gate — burn-through wind-down (durable DO alarm, FIX 1)', () => {
  it('arms a DURABLE schedule at create (migrated off the WS-resident setTimeout)', async () => {
    // FIX 1 migration: the burn-through is now an Agents-SDK `schedule()` row, not a
    // setTimeout. Creating with a finite budget arms a durable schedule id.
    const db = new FakeCompanionDb() // fresh user → welcome +10 → budget 10 minutes
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')
    await createSessionOverWs(socket)

    const scheduleId = await handle.run((instance) => asPrivate(instance).burnScheduleId)
    expect(typeof scheduleId).toBe('string')
    expect(scheduleId).not.toBe('')

    // Tearing the session down cancels the durable schedule.
    await handle.run((instance) => {
      asPrivate(instance).hasDeliveredTurn = true
    })
    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')
  })

  it('fires via the real DO alarm dispatch, runs the wind-down recap, deducts, and closes balance-depleted', async () => {
    const db = new FakeCompanionDb() // fresh user → welcome +10 → budget 10 minutes
    const handle = makeSessionDo()
    // Shrink the per-minute basis to 0 BEFORE `create` reads it, so the schedule is
    // due immediately (`time <= now`) and the real alarm dispatch fires the
    // wind-down. The SDK stores schedule time at 1-second granularity, so this is
    // the deterministic way to exercise the genuine schedule→alarm→callback chain.
    await handle.run((instance) => {
      const view = asPrivate(instance)
      view.env = { ...view.env, COMPANION_DB: db } as SessionDoEnv
      view.burnSecondsPerMinute = 0
    })
    const socket: TestSocket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    // Fire the due burn-through alarm through the REAL SDK dispatch (runs the DO's
    // `alarm()`, which dispatches `onBurnThroughAlarm`). Robust to a runtime that
    // ALSO auto-fires the past-due alarm — `waitFor(summary)` converges either way.
    await runDurableObjectAlarm(handle.stub)
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

  it('still deducts the depleted budget when the alarm fires on a NON-resident (evicted) session', async () => {
    // The durability win: the old setTimeout was LOST on an isolate eviction, so a
    // depleted session was never billed. The durable schedule survives — when the
    // alarm fires on a fresh post-eviction instance (in-memory `sessionState` gone),
    // `onBurnThroughAlarm` bills the budget from its persisted payload. Modeled here
    // by dispatching the callback against a DO with NO bound session.
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)

    // No session is bound (fresh instance, exactly as after an eviction). The alarm
    // dispatches with the payload the schedule persisted at create.
    await fireBurnAlarm(handle, {
      sessionId: 'evicted-session',
      userId: 'user-A',
      budgetMinutes: 7,
      fundingSource: 'earned',
    })

    await waitFor(() => db.deductRows().length === 1, 'durable eviction-path deduct')
    expect(db.deductRows()).toHaveLength(1)
    expect(db.deductRows()[0].source_key).toBe('session:evicted-session')
    expect(db.deductRows()[0].source_ref).toBe('session:earned')
    expect(db.deductRows()[0].amount).toBe(-7) // the full depleted budget
  })

  it('the eviction-path deduct is idempotent on session:{sessionId} (no double-charge vs a prior teardown)', async () => {
    // Belt-and-braces: if a normal teardown already wrote the session's deduct AND a
    // stale alarm still fires (cancel raced), the ON CONFLICT (source_key) makes the
    // alarm deduct a no-op — the session is billed exactly once.
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    // A prior teardown already billed this session 2 minutes.
    db.seed({
      user_id: 'user-A',
      asset_type: 'starburst',
      amount: -2,
      source_product: 'amiclaw',
      source_ref: 'session:earned',
      source_key: 'session:already-billed',
      earned_at: '2026-07-01T00:05:00.000Z',
    })

    await fireBurnAlarm(handle, {
      sessionId: 'already-billed',
      userId: 'user-A',
      budgetMinutes: 9,
      fundingSource: 'earned',
    })
    await settle()

    // Still exactly one deduct row for the session, still the original -2 (the alarm's
    // -9 was an ON CONFLICT no-op).
    const rows = db.deductRows().filter((r) => r.source_key === 'session:already-billed')
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(-2)
  })

  it('bills the FULL budget at production arithmetic when the budget elapses (magnitude + cap)', async () => {
    // F3: the accelerated end-to-end test above floors in-test elapsed to 1 minute
    // (shrunk burnMinuteMs), so it only locks amount < 0. This locks the magnitude
    // the burn-through path actually bills: at real 60_000 ms/min arithmetic, a
    // session whose whole budget has elapsed bills exactly -budget, capped there.
    const BUDGET = 3
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)

    await handle.run((instance) => {
      const sid = instance.createSession('demo-mock', 'user-A', MANUAL, undefined, {
        budgetMinutes: BUDGET,
      })
      // Backdate the start past the whole budget (budget minutes + 30 s): the raw
      // elapsed ceils to BUDGET + 1, so the deduct proves BOTH that a burn-through
      // bills the full budget AND that the cap holds (min(elapsed, budget) = budget).
      const view = asPrivate(instance)
      view.hasDeliveredTurn = true // delivered a turn (FIX 3 floor gate)
      if (view.sessionState) view.sessionState.startedAtMs = Date.now() - (BUDGET * 60_000 + 30_000)
      instance.endSession(sid, 'user-A')
    })

    await waitFor(() => db.deductRows().length === 1, 'one deduct row')
    expect(db.deductRows()[0].amount).toBe(-BUDGET)
  })
})

// --- burn-through wind-down: the 3 concurrency edges (PR #254 codex findings) -----

describe('VoiceSessionDO pricing gate — burn-through wind-down concurrency', () => {
  it('finding 1 — a mid-turn budget-alarm fire DEFERS the wind-down: the reply and the wind-down recap run strictly serially, exactly one deduct', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const db = new FakeCompanionDb() // fresh user → welcome +10 → budget 10 minutes
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    // A voice reply is parked at the gated LLM — the turn is in flight.
    await driveUtteranceToLlm(socket, kit, 1)
    expect(kit.llmTurns).toHaveLength(1)

    // The burn-through alarm fires WHILE the reply is parked. It must DEFER, not
    // start a second concurrent stream: `pendingWindDown` is set and the schedule
    // id is cleared — but NO wind-down recap has reached the LLM (no overlap) and no
    // depletion summary has been sent (no premature teardown).
    await fireBurnAlarm(handle, {
      sessionId,
      userId: 'user-A',
      budgetMinutes: 10,
      fundingSource: 'earned',
    })
    const deferred = await handle.run((instance) => {
      const view = asPrivate(instance)
      return {
        pending: view.pendingWindDown !== undefined,
        scheduleCleared: view.burnScheduleId === undefined,
      }
    })
    expect(deferred.pending).toBe(true)
    expect(deferred.scheduleCleared).toBe(true)
    expect(kit.llmTurns).toHaveLength(1) // recap has NOT started → no overlap
    expect(socket.messagesOfType('summary')).toHaveLength(0)

    // Release the reply. Its `streamTurn` finally re-invokes the deferred wind-down,
    // which only NOW starts the recap turn (llmTurns[1]).
    await handle.run(() => {
      kit.llmTurns[0].pushDelta('reply.')
      kit.llmTurns[0].finishStream()
    })
    await waitFor(() => kit.llmTurns.length === 2, 'the deferred wind-down recap started')
    // Serialization proof: the reply fully drained BEFORE the recap started.
    expect(kit.llmTurns[0].settled()).toBe(true)

    // Release the recap. The wind-down tears down: a balance-depleted summary, a
    // 1000 close, and exactly one deduct.
    await handle.run(() => {
      kit.llmTurns[1].pushDelta('farewell.')
      kit.llmTurns[1].finishStream()
    })
    await waitForMessage(socket, 'summary')
    expect(socket.messagesOfType('summary')[0].reason).toBe('balance-depleted')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'depletion close')

    await settle()
    await waitFor(() => db.deductRows().length === 1, 'exactly one deduct row')
    expect(db.deductRows()).toHaveLength(1)
    expect(db.deductRows()[0].source_key).toBe(`session:${sessionId}`)
  })

  it('finding 2 — the depletion teardown clears every DO guard: after the balance-depleted close, no timer/turn state lingers and nothing fires', async () => {
    // Real demo-mock providers (no gating) — the happy-path depletion, asserting
    // the teardown mirrors a normal `end`: every guard cleared, nothing post-close.
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    // Fire the burn-through alarm (no turn in flight) → the full depletion teardown.
    await fireBurnAlarm(handle, {
      sessionId,
      userId: 'user-A',
      budgetMinutes: 10,
      fundingSource: 'earned',
    })
    await waitFor(() => socket.messagesOfType('summary').length > 0, 'burn-through summary', 4000)
    expect(socket.messagesOfType('summary')[0].reason).toBe('balance-depleted')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'depletion close')

    const chunksAtClose = socket.messagesOfType('chunk').length
    const summariesAtClose = socket.messagesOfType('summary').length

    // Every DO-resident guard is cleared by the teardown (the burn-through schedule,
    // the deferred-wind-down slot, the turn guards), and the session is fully unbound
    // — so nothing DO-side can fire after the close.
    const state = await handle.run((instance) => {
      const view = asPrivate(instance)
      return {
        burnScheduleId: view.burnScheduleId,
        pendingWindDown: view.pendingWindDown,
        turnInFlight: view.turnInFlight,
        activeTurn: view.activeTurn,
        sessionBound: view.sessionState !== undefined,
      }
    })
    expect(state.burnScheduleId).toBeUndefined()
    expect(state.pendingWindDown).toBeUndefined()
    expect(state.turnInFlight).toBe(false)
    expect(state.activeTurn).toBeUndefined()
    expect(state.sessionBound).toBe(false)

    // Give any stray timer / callback a chance to fire — nothing does.
    await settle()
    await settle()
    expect(socket.messagesOfType('chunk').length).toBe(chunksAtClose)
    expect(socket.messagesOfType('summary').length).toBe(summariesAtClose)
    expect(db.deductRows()).toHaveLength(1) // no post-close double-deduct
  })

  it('finding 3 — a speech-start barge-in during the depletion farewell still fully tears down: deduct written, 1000 close, session terminal', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    // Schedule due immediately (basis 0) so the real alarm dispatch fires the recap.
    await handle.run((instance) => {
      const view = asPrivate(instance)
      view.env = { ...view.env, COMPANION_DB: db } as SessionDoEnv
      view.burnSecondsPerMinute = 0
    })
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    // Fire the due burn-through alarm in the background (non-awaited: the recap parks
    // at the gated LLM, so the alarm handler stays pending until we release it). A
    // runtime that also auto-fires the past-due alarm is harmless — the one-shot
    // schedule row is consumed once, so only one wind-down ever runs.
    void runDurableObjectAlarm(handle.stub).catch(() => {})

    // The wind-down recap parks at the gated LLM — the farewell is now "playing".
    await waitFor(
      () => kit.llmTurns.length === 1,
      'the wind-down recap reached the gated LLM',
      4000
    )

    // The client VAD barges in MID-farewell: `speech-start` supersedes the recap
    // turn (epoch bump) and opens a fresh recognizer — confirmed by the gated STT
    // being entered (the recap is LLM+TTS only, so sttCalls was 0 until now).
    socket.send(JSON.stringify({ type: 'speech-start' }))
    await waitFor(() => kit.sttCalls() === 1, 'the barge-in opened a fresh recognizer', 2000)

    // Release the (superseded) recap so `windDown` resumes past its `await`. The
    // depletion outcome must STILL be terminal despite the barge-in.
    await handle.run(() => {
      kit.llmTurns[0].pushDelta('farewell.')
      kit.llmTurns[0].finishStream()
    })

    await waitForMessage(socket, 'summary')
    expect(socket.messagesOfType('summary')[0].reason).toBe('balance-depleted')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'depletion close')
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'balance depleted' })

    await settle()
    await waitFor(() => db.deductRows().length === 1, 'one deduct row')
    expect(db.deductRows()).toHaveLength(1)
    expect(db.deductRows()[0].source_key).toBe(`session:${sessionId}`)
    // The session is fully unbound — the depletion is terminal, not half-torn-down.
    const bound = await handle.run((instance) => asPrivate(instance).sessionState !== undefined)
    expect(bound).toBe(false)
  })
})

// --- FIX 2: a stuck provider turn is force-canceled so the deferred wind-down fires

describe('VoiceSessionDO pricing gate — stuck-turn hard deadline (FIX 2)', () => {
  it('force-cancels a never-resolving turn so a wind-down deferred behind it still fires + deducts', async () => {
    // The stuck-turn gap: a hung LLM/TTS turn pins `turnInFlight`, so a burn-through
    // wind-down deferred behind it (finding 1) would NEVER fire — free minutes past
    // budget. The per-turn hard deadline force-cancels the stuck turn, releasing the
    // guard so the deferred wind-down runs and the session is billed.
    const stuck = makeStuckLlm() // an LLM parked at a never-settling promise
    const bundle = makeTurnProviders(stuck.llm) // counting STT + mock TTS + stuck LLM
    providerControl.override = bundle.providers
    const db = new FakeCompanionDb() // fresh user → welcome +10 → budget 10
    const handle = makeSessionDo()
    // Shrink the per-turn cap so the stuck reply (and the stuck wind-down recap) are
    // force-canceled fast with a real timer, no fake timers.
    await handle.run((instance) => {
      const view = asPrivate(instance)
      view.env = { ...view.env, COMPANION_DB: db } as SessionDoEnv
      view.maxTurnMs = 150
    })
    const socket = await openSocket(handle, 'user-A')
    const sessionId = await createSessionOverWs(socket)

    // Drive a player turn — it delivers the terminal transcript frame, then parks at
    // the stuck LLM. Wait until the reply is genuinely in flight.
    socket.send(SPEECH_START)
    socket.send(TURN)
    await waitForDoState(handle, (v) => v.turnInFlight === true, 'reply parked at the stuck LLM')

    // The budget alarm fires WHILE the stuck reply is in flight → it DEFERS (a
    // wind-down can never overlap a live turn). Without FIX 2 the stuck turn would
    // pin turnInFlight forever and this deferred wind-down would never fire.
    await fireBurnAlarm(handle, {
      sessionId,
      userId: 'user-A',
      budgetMinutes: 10,
      fundingSource: 'earned',
    })
    await waitForDoState(
      handle,
      (v) => v.pendingWindDown !== undefined,
      'wind-down deferred behind the stuck turn'
    )

    // The per-turn deadline force-cancels the stuck reply → `streamTurn` releases the
    // guard → the deferred wind-down fires. Its recap ALSO hits the stuck LLM and is
    // force-canceled by the same deadline, so the teardown (deduct + depletion
    // summary + 1000 close) still completes despite the provider never resolving.
    await waitFor(
      () => socket.messagesOfType('summary').length > 0,
      'the deferred wind-down fired despite the stuck turn',
      6000
    )
    expect(socket.messagesOfType('summary')[0].reason).toBe('balance-depleted')
    await waitFor(() => socket.closeEvents.some((c) => c.code === 1000), 'depletion close')

    await waitFor(() => db.deductRows().length === 1, 'the deferred wind-down still deducted')
    expect(db.deductRows()).toHaveLength(1)
    expect(db.deductRows()[0].source_key).toBe(`session:${sessionId}`)
    expect(db.deductRows()[0].amount).toBeLessThan(0)
    // NB: the stuck generator's own `finally` never runs — `return()` cannot interrupt
    // a pending provider `await` (the documented caveat) — which is exactly why the
    // force-cancel operates at the `streamTurn` level (break + guard release) rather
    // than by unwinding the generator; the leaked provider promise is accepted.
  })

  it('force-cancels a stuck ordinary player turn (no wind-down) so the guard is released', async () => {
    // The simpler shape: a stuck turn with no budget pressure still gets force-canceled
    // by the deadline, so `turnInFlight` is released and the session stays usable.
    const stuck = makeStuckLlm()
    const bundle = makeTurnProviders(stuck.llm)
    providerControl.override = bundle.providers
    const handle = makeSessionDo() // no COMPANION_DB → priceless, no burn schedule
    await handle.run((instance) => {
      asPrivate(instance).maxTurnMs = 150
    })
    const socket = await openSocket(handle, 'user-A')
    await createSessionOverWs(socket)

    socket.send(SPEECH_START)
    socket.send(TURN)
    await waitForDoState(handle, (v) => v.turnInFlight === true, 'reply parked at the stuck LLM')

    // The per-turn deadline trips and force-cancels the stuck turn: turnInFlight clears
    // even though the provider `await` never settles (the guard release happens at the
    // `streamTurn` level, not by unwinding the leaked generator).
    await waitForDoState(
      handle,
      (v) => v.turnInFlight === false,
      'the stuck turn was force-canceled and released the guard',
      4000
    )
  })
})

// --- PR #257 codex review — 3 P2 correctness fixes -------------------------------

describe('VoiceSessionDO pricing gate — PR #257 codex P2 fixes', () => {
  it('P2#1 — a STALE alarm for an earlier session does not clobber the bound session schedule id and bills only its own session', async () => {
    // A reused DO: session B is bound; a stale alarm armed by an EARLIER session A
    // fires (its own cancel raced). It must not touch B's `burnScheduleId` (which
    // would strand B's alarm and later mis-bill B's full budget), and must bill only
    // its own `payload.sessionId`.
    const db = new FakeCompanionDb()
    const handle = makeSessionDo()
    await injectCompanionDb(handle, db)
    const socket = await openSocket(handle, 'user-A')
    const sessionB = await createSessionOverWs(socket) // binds B, arms schedule idB

    const idBefore = await handle.run((instance) => asPrivate(instance).burnScheduleId)
    expect(typeof idBefore).toBe('string')

    // The stale alarm for session A fires while B is bound.
    await fireBurnAlarm(handle, {
      sessionId: 'stale-session-A',
      userId: 'user-A',
      budgetMinutes: 5,
      fundingSource: 'earned',
    })

    // B's schedule id is UNTOUCHED — B can still cancel its own alarm on close.
    const idAfter = await handle.run((instance) => asPrivate(instance).burnScheduleId)
    expect(idAfter).toBe(idBefore)
    // The stale alarm billed ONLY its own session A, never B.
    expect(db.deductRows().map((r) => r.source_key)).toEqual(['session:stale-session-A'])
    expect(db.deductRows().find((r) => r.source_key === `session:${sessionB}`)).toBeUndefined()

    // B delivered nothing and closes: FIX 3 zero-bill AND the (intact) alarm is
    // canceled — so B is never mis-billed the full budget.
    socket.send(JSON.stringify({ type: 'end' }))
    await waitForMessage(socket, 'summary')
    await settle()
    expect(db.deductRows().find((r) => r.source_key === `session:${sessionB}`)).toBeUndefined()
  })

  it('P2#2 — a force-canceled turn that already streamed a chunk emits a terminal done frame (socket stays open)', async () => {
    // The client sets its streaming flag on the first chunk and clears it only on a
    // `done` frame or a socket close. A force-cancel after a partial stream must emit
    // a terminal `done:true` so the client is not left mid-stream (which would
    // suppress later utterances).
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const handle = makeSessionDo() // priceless — this is about the wire, not billing
    await handle.run((instance) => {
      asPrivate(instance).maxTurnMs = 200
    })
    const socket = await openSocket(handle, 'user-A')
    await createSessionOverWs(socket)

    // Turn parks at the gated LLM; stream ONE partial text chunk, then leave it hung.
    await driveUtteranceToLlm(socket, kit, 1)
    await handle.run(() => {
      kit.llmTurns[0].pushDelta('partial reply')
    })
    await waitFor(
      () =>
        messagesOfType(socket, 'chunk').some(
          (c) => c.kind === 'text' && c.text === 'partial reply'
        ),
      'partial chunk reached the client'
    )
    expect(sawDoneChunk(socket)).toBe(false) // mid-stream — no terminal frame yet

    // The per-turn deadline force-cancels the hung turn → it MUST emit a terminal
    // done frame so the client clears its streaming state.
    await waitFor(() => sawDoneChunk(socket), 'force-cancel emitted a terminal done frame', 4000)
    // The socket stays OPEN — the session continues, later utterances not suppressed.
    await settle()
    expect(socket.closeEvents).toHaveLength(0)
  })

  it('P2#3 — a force-cancel bumps the turn generation and a LATE-completing turn does not mutate state', async () => {
    // The per-turn deadline bumps `turnGeneration`; a timed-out turn whose provider
    // ignores the abort and completes late is fenced (its settle is a no-op), so it
    // cannot corrupt `turnCount` / `history` for the abandoned turn. (The fence
    // mechanism itself is unit-tested in turn-pipeline.test.ts.)
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const handle = makeSessionDo()
    await handle.run((instance) => {
      asPrivate(instance).maxTurnMs = 150
    })
    const socket = await openSocket(handle, 'user-A')
    await createSessionOverWs(socket)

    const before = await handle.run((instance) => {
      const s = asPrivate(instance).sessionState
      return {
        turnCount: s?.turnCount ?? -1,
        historyLen: s?.history.length ?? -1,
        gen: s?.turnGeneration ?? -1,
      }
    })

    // The turn parks at the gated LLM, then the per-turn deadline force-cancels it.
    await driveUtteranceToLlm(socket, kit, 1)
    await waitForDoState(
      handle,
      (v) => v.turnInFlight === false,
      'turn force-canceled by the deadline'
    )
    const genAfterCancel = await handle.run(
      (instance) => asPrivate(instance).sessionState?.turnGeneration ?? -1
    )
    expect(genAfterCancel).toBe(before.gen + 1) // force-cancel bumped the generation

    // The provider ignored the abort and completes LATE (after the guard released).
    await handle.run(() => {
      kit.llmTurns[0].finishStream()
    })
    await settle()
    await settle()

    const after = await handle.run((instance) => {
      const s = asPrivate(instance).sessionState
      return { turnCount: s?.turnCount ?? -1, historyLen: s?.history.length ?? -1 }
    })
    expect(after.turnCount).toBe(before.turnCount) // no stale turnCount increment
    expect(after.historyLen).toBe(before.historyLen) // no stale history mutation
  })
})
