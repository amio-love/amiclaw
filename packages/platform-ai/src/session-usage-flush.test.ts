import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildUsageRecord,
  flushSessionUsage,
  usageKeyFor,
  type SessionUsageSnapshot,
  type UsageKvWriter,
} from './usage-flush'
import type { UsageCounters } from './turn-pipeline'
import type { SttUsageSource } from './providers/types'

/**
 * Tests for the session-terminal usage flush (P3 of the usage-metering task):
 * the pure `usage-flush.ts` core directly, and the DO's exactly-once /
 * all-terminal-paths flush wiring via a faithful stand-in. `VoiceSessionDO`
 * imports `cloudflare:workers` and cannot be instantiated in the Node test
 * environment, so — exactly as the per-socket identity, end-cleanup, and
 * epoch-guard mechanisms are tested (see `session-identity.test.ts`,
 * `session-end-cleanup.test.ts`, `session-epoch-guard.test.ts`) — the
 * stand-in (`FakeSessionDo`) mirrors the real fields (`state` / `userId` /
 * `sessionId` / `usageFlushed` / `ownerSocket`), the public `endSession`
 * contract body (the flush boundary), the real `handleControl` `end` branch,
 * `onSocketClose` owner branch, `flushUsage` (including its `ctx.waitUntil`
 * registration), and `clearSession` one-for-one.
 *
 * The contract under test (L2 §Mechanism Variant 4):
 *  - Every terminal path flushes: the public `endSession` contract method
 *    (reached directly over the DO stub OR via the WS `end` branch) AND an
 *    abrupt owner-socket close.
 *  - Exactly once per session: end-then-close, double end, double close — one
 *    write total, keyed `usage:{date}:{user_id}:{session_id}`.
 *  - The background flush promise is registered on the DO lifecycle
 *    (`ctx.waitUntil`), never bare-voided.
 *  - The guard is per-session: a new `create` on the same resident DO resets
 *    it, so session 2 flushes even though session 1 already did (the
 *    cross-generation misfire the `turnEpoch` epoch guard warns about).
 *  - FAIL-OPEN: a KV failure logs and is swallowed; an absent USAGE binding
 *    skips silently. Session teardown is never blocked either way.
 */

// --- KV test doubles ----------------------------------------------------------

/** Recording KV double implementing the structural `put` slice. */
class FakeUsageKv implements UsageKvWriter {
  readonly puts: Array<{ key: string; value: string }> = []

  async put(key: string, value: string): Promise<void> {
    this.puts.push({ key, value })
  }
}

/** KV double whose every put rejects — the fail-open injection point. */
class FailingUsageKv implements UsageKvWriter {
  attempts = 0

  async put(): Promise<void> {
    this.attempts += 1
    throw new Error('kv unavailable')
  }
}

const COUNTERS: UsageCounters = {
  llmInputTokens: 100,
  llmOutputTokens: 50,
  sttInputSeconds: 12.5,
  ttsOutputSeconds: 8.25,
}

function snapshot(overrides: Partial<SessionUsageSnapshot> = {}): SessionUsageSnapshot {
  return {
    sessionId: 'session-uuid-1',
    userId: 'user-A',
    gameId: 'demo-mock',
    turnCount: 3,
    usage: { ...COUNTERS },
    sttSource: 'provider-reported',
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// --- pure core: key + record + fail-open --------------------------------------

describe('usageKeyFor', () => {
  it('builds usage:{date}:{user_id}:{session_id} with the UTC date at flush time', () => {
    // 23:30 UTC on the 11th is already the 12th in UTC+8 — the key must use
    // UTC, not the local calendar.
    const flushedAt = new Date('2026-06-11T23:30:00Z')
    expect(usageKeyFor(flushedAt, 'user-A', 'session-uuid-1')).toBe(
      'usage:2026-06-11:user-A:session-uuid-1'
    )
  })
})

describe('buildUsageRecord', () => {
  it('carries the four counters, sttSource, gameId, turnCount, and the flush timestamp', () => {
    const flushedAt = new Date('2026-06-11T08:00:00Z')
    expect(buildUsageRecord(snapshot(), flushedAt)).toEqual({
      gameId: 'demo-mock',
      turnCount: 3,
      usage: COUNTERS,
      sttSource: 'provider-reported',
      flushedAt: '2026-06-11T08:00:00.000Z',
    })
  })

  it('copies the counters instead of aliasing the live session object', () => {
    const snap = snapshot()
    const record = buildUsageRecord(snap, new Date('2026-06-11T08:00:00Z'))
    snap.usage.llmInputTokens = 999999
    expect(record.usage.llmInputTokens).toBe(100)
  })
})

describe('flushSessionUsage — fail-open', () => {
  it('writes one record under the usage key', async () => {
    const kv = new FakeUsageKv()
    await flushSessionUsage(kv, snapshot(), new Date('2026-06-11T08:00:00Z'))

    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toBe('usage:2026-06-11:user-A:session-uuid-1')
    expect(JSON.parse(kv.puts[0].value)).toEqual({
      gameId: 'demo-mock',
      turnCount: 3,
      usage: COUNTERS,
      sttSource: 'provider-reported',
      flushedAt: '2026-06-11T08:00:00.000Z',
    })
  })

  it('skips silently when the USAGE binding is absent (dev/demo deploys)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(flushSessionUsage(undefined, snapshot())).resolves.toBeUndefined()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs and swallows a KV put failure — never rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const kv = new FailingUsageKv()

    await expect(flushSessionUsage(kv, snapshot())).resolves.toBeUndefined()

    expect(kv.attempts).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('usage flush failed for usage:')
  })
})

// --- a faithful DO terminal-path stand-in --------------------------------------

/** A stand-in socket — only reference identity matters to the owner-socket gate. */
type FakeWs = { id: string }
const OWNER: FakeWs = { id: 'owner-socket' }

interface FakeState {
  gameId: string
  turnCount: number
  usage: UsageCounters
  sttSource: SttUsageSource
}

/**
 * Records promises registered on the DO lifecycle — the `ctx.waitUntil`
 * scheduling seam. Mirrors the one `DurableObjectState` member `flushUsage`
 * uses, so tests can assert the flush promise was REGISTERED (kept alive by
 * the runtime until it settles) rather than bare-voided.
 */
class FakeDoCtx {
  readonly registered: Promise<unknown>[] = []

  waitUntil(promise: Promise<unknown>): void {
    this.registered.push(promise)
  }
}

/**
 * Mirrors `VoiceSessionDO`'s terminal-path wiring one-for-one: the session
 * fields (`state` / `userId` / `sessionId` / `usageFlushed` / `ownerSocket`),
 * `createSession`'s atomic publish (fresh minted id + `usageFlushed = false`),
 * the public `endSession` contract body (summary -> flush — the contract-level
 * flush boundary), the `end` branch (owner-socket gate -> `endSession` ->
 * clear), the `onSocketClose` owner branch (gate -> flush -> clear),
 * `flushUsage`'s guard + snapshot + `ctx.waitUntil`-registered
 * `flushSessionUsage`, and `clearSession`'s reset. Turn-cancel mechanics are
 * owned by `session-end-cleanup.test.ts` / `session-epoch-guard.test.ts` and
 * elided here.
 */
class FakeSessionDo {
  state: FakeState | undefined
  userId: string | undefined
  sessionId: string | undefined
  ownerSocket: FakeWs | undefined
  usageFlushed = false
  /** The DO-lifecycle scheduling seam `flushUsage` registers its promise on. */
  readonly ctx = new FakeDoCtx()

  constructor(private readonly env: { USAGE?: UsageKvWriter }) {}

  /** Mirrors `createSession` + the `create` control branch's owner record. */
  create(userId: string, state: FakeState, ws: FakeWs = OWNER): boolean {
    if (this.state) return false
    // Atomic publish — mirrors the real field set, minted UUID included.
    this.sessionId = crypto.randomUUID()
    this.userId = userId
    this.state = state
    this.usageFlushed = false
    this.ownerSocket = ws
    return true
  }

  /** Mirrors `socketIsBoundSessionOwner` for the teardown gates. */
  private isOwnerSocket(ws: FakeWs): boolean {
    if (this.state === undefined || this.userId === undefined) return false
    return this.ownerSocket !== undefined && ws === this.ownerSocket
  }

  /**
   * Mirrors the public `endSession` contract body: settle the summary off the
   * live state, then flush — the flush boundary lives HERE, not in the WS
   * branch, so a direct contract call (no WS framing) is metered too. Like
   * the real method, it does NOT clear the session; teardown belongs to the
   * caller (`end` branch / owner-close).
   */
  endSession(): { turnCount: number } {
    if (!this.state || !this.userId || this.sessionId === undefined) {
      throw new Error('endSession before createSession')
    }
    const summary = { turnCount: this.state.turnCount }
    this.flushUsage()
    return summary
  }

  /** Mirrors the `end` control branch: gate -> `endSession` (flushes) -> clear. */
  end(ws: FakeWs = OWNER): boolean {
    if (!this.state || !this.userId || this.sessionId === undefined) return false
    if (!this.isOwnerSocket(ws)) return false
    this.endSession()
    this.clearSession()
    return true
  }

  /** Mirrors the `onSocketClose` owner branch: gate -> flush -> clear. */
  socketClose(ws: FakeWs): void {
    if (!this.isOwnerSocket(ws)) return
    this.flushUsage()
    this.clearSession()
  }

  /** Mirrors `VoiceSessionDO.flushUsage` one-for-one (incl. `ctx.waitUntil`). */
  private flushUsage(): void {
    const state = this.state
    const sessionId = this.sessionId
    const userId = this.userId
    if (!state || sessionId === undefined || userId === undefined) return
    if (this.usageFlushed) return
    this.usageFlushed = true
    this.ctx.waitUntil(
      flushSessionUsage(this.env.USAGE, {
        sessionId,
        userId,
        gameId: state.gameId,
        turnCount: state.turnCount,
        usage: { ...state.usage },
        sttSource: state.sttSource,
      })
    )
  }

  /** Mirrors `clearSession`'s session-field reset (epoch/turn fields elided). */
  private clearSession(): void {
    this.state = undefined
    this.userId = undefined
    this.sessionId = undefined
    this.ownerSocket = undefined
    this.usageFlushed = false
  }

  /** Let the lifecycle-registered background flushes settle. */
  async settle(): Promise<void> {
    await Promise.all(this.ctx.registered)
  }
}

function liveState(): FakeState {
  return {
    gameId: 'demo-mock',
    turnCount: 2,
    usage: { ...COUNTERS },
    sttSource: 'derived-from-bytes',
  }
}

describe('session-terminal flush — every terminal path flushes exactly once', () => {
  it('a normal end flushes one record keyed by date/user/session', async () => {
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())
    const sessionId = do_.sessionId as string

    expect(do_.end()).toBe(true)
    await do_.settle()

    expect(kv.puts).toHaveLength(1)
    const utcDate = new Date().toISOString().slice(0, 10)
    expect(kv.puts[0].key).toBe(`usage:${utcDate}:user-A:${sessionId}`)
    const record = JSON.parse(kv.puts[0].value) as {
      gameId: string
      turnCount: number
      usage: UsageCounters
      sttSource: string
    }
    expect(record.gameId).toBe('demo-mock')
    expect(record.turnCount).toBe(2)
    expect(record.usage).toEqual(COUNTERS)
    expect(record.sttSource).toBe('derived-from-bytes')
    // The session is cleanly torn down after the flush.
    expect(do_.state).toBeUndefined()
    expect(do_.sessionId).toBeUndefined()
  })

  it('an abrupt owner-socket close (no end) flushes the same single record', async () => {
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())
    const sessionId = do_.sessionId as string

    do_.socketClose(OWNER)
    await do_.settle()

    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)
    expect(do_.state).toBeUndefined()
  })

  it('end followed by the owner socket close writes once, not twice', async () => {
    // The real DO's close handler is unreachable after `end` (clearSession
    // already unbound the owner), and the usageFlushed guard backstops it —
    // either way: one write.
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    do_.end()
    do_.socketClose(OWNER)
    await do_.settle()

    expect(kv.puts).toHaveLength(1)
  })

  it('a double end writes once', async () => {
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    do_.end()
    do_.end()
    await do_.settle()

    expect(kv.puts).toHaveLength(1)
  })

  it('a non-owner socket close flushes nothing (the session is still live)', async () => {
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    do_.socketClose({ id: 'same-user-duplicate-tab' })
    await do_.settle()

    expect(kv.puts).toHaveLength(0)
    expect(do_.state).toBeDefined()
  })

  it('the guard is per-session: a reconnect session on the same DO flushes its own record', async () => {
    // Cross-generation correctness: session 1 ends (flushes, guard tripped),
    // a new session opens on the SAME resident DO (create resets the guard),
    // and its end must flush AGAIN — under its own minted id.
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })

    do_.create('user-A', liveState())
    const firstId = do_.sessionId as string
    do_.end()

    do_.create('user-A', { ...liveState(), turnCount: 7 })
    const secondId = do_.sessionId as string
    do_.end()
    await do_.settle()

    expect(kv.puts).toHaveLength(2)
    expect(firstId).not.toBe(secondId)
    expect(kv.puts[0].key).toContain(firstId)
    expect(kv.puts[1].key).toContain(secondId)
    expect((JSON.parse(kv.puts[1].value) as { turnCount: number }).turnCount).toBe(7)
  })
})

describe('public endSession contract — the flush boundary lives in the method body', () => {
  it('a direct endSession call (no WS end message) flushes exactly once via the production mechanism', async () => {
    // A consumer driving the four-method contract over the DO stub never sends
    // a WS 'end' message — the flush must ride inside `endSession` itself, or
    // that caller ends the session unmetered.
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())
    const sessionId = do_.sessionId as string

    do_.endSession()
    await do_.settle()

    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].key).toContain(`:user-A:${sessionId}`)
    expect((JSON.parse(kv.puts[0].value) as { turnCount: number }).turnCount).toBe(2)
  })

  it('a repeated direct endSession call stays guarded — still one write', async () => {
    // `endSession` does not clear the session (teardown belongs to the WS
    // branch / owner-close), so a second direct call passes the state checks;
    // the per-session `usageFlushed` guard must absorb it.
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    do_.endSession()
    do_.endSession()
    await do_.settle()

    expect(kv.puts).toHaveLength(1)
  })

  it('the WS end branch does not regress: an end message still flushes exactly once', async () => {
    // The branch carries no flush of its own anymore — the single write rides
    // inside the `endSession` call it makes.
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    expect(do_.end()).toBe(true)
    await do_.settle()

    expect(kv.puts).toHaveLength(1)
  })
})

describe('flush scheduling — the write is registered on the DO lifecycle (ctx.waitUntil)', () => {
  it('end registers exactly one flush promise via waitUntil instead of bare-voiding it', async () => {
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    do_.end()

    // The promise is handed to the lifecycle seam synchronously at flush time,
    // so the runtime keeps the DO alive until the background put settles.
    expect(do_.ctx.registered).toHaveLength(1)
    await do_.settle()
    expect(kv.puts).toHaveLength(1)
  })

  it('the abrupt owner-close path registers its flush promise the same way', async () => {
    const kv = new FakeUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    do_.socketClose(OWNER)

    expect(do_.ctx.registered).toHaveLength(1)
    await do_.settle()
    expect(kv.puts).toHaveLength(1)
  })
})

describe('session-terminal flush — fail-open against the player path', () => {
  it('a KV put failure still tears the session down cleanly and logs the error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const kv = new FailingUsageKv()
    const do_ = new FakeSessionDo({ USAGE: kv })
    do_.create('user-A', liveState())

    // end() must not throw — the failure stays inside the background flush.
    expect(do_.end()).toBe(true)
    await do_.settle()

    expect(kv.attempts).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // Teardown completed despite the failed write.
    expect(do_.state).toBeUndefined()
    expect(do_.sessionId).toBeUndefined()
  })

  it('a missing USAGE binding skips the flush and the session still closes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const do_ = new FakeSessionDo({})
    do_.create('user-A', liveState())

    expect(do_.end()).toBe(true)
    await do_.settle()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(do_.state).toBeUndefined()
  })
})
