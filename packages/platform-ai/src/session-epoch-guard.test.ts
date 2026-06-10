import { describe, expect, it } from 'vitest'
import type { AiResponseChunk } from './contract'

/**
 * Regression tests for the session-generation EPOCH guard (the P2 from PR #156
 * review, raised by the prior `clearSession` fix). `VoiceSessionDO` imports
 * `cloudflare:workers` and cannot be instantiated in the Node test environment,
 * so — exactly as the per-socket identity, `runTurn`, turn-guard, and end-cleanup
 * mechanisms are tested via faithful stand-ins (see `session-identity.test.ts`,
 * `turn-pipeline.test.ts`, `session-turn-guard.test.ts`,
 * `session-end-cleanup.test.ts`) — these tests model the DO's control-dispatch
 * logic with a stand-in (`FakeSessionDo`) that mirrors the real fields
 * (`state` / `userId` / `providers` / `turnInFlight` / `activeTurn` / `bridge` /
 * `turnEpoch`) and the real `handleControl` `end` / `create` / `turn` branches
 * plus the `clearSession` reset and the EPOCH-GUARDED turn-loop `finally`
 * one-for-one.
 *
 * The defect's shape (cross-generation clobber): on `end` / owner-close mid-turn,
 * the DO fire-and-forgets the cancel (a provider promise may still be pending) and
 * `clearSession()` makes the same-named DO immediately reusable. The canceled
 * turn's loop `finally` still runs LATER, when its iterator finally settles. If a
 * client reconnects in that window — `create`s a fresh session and starts a NEW
 * turn (setting fresh `turnInFlight`/`activeTurn`) — an UNCONDITIONAL clear in the
 * stale `finally` would (1) reopen the overlap guard so the new session is again
 * attackable by an overlapping `turn`, and (2) null out the new `activeTurn` so
 * the new turn can no longer be canceled by `end`. Root cause: cleanup wrote
 * shared fields across the "old turn generation" / "new session generation"
 * boundary.
 *
 * The fix gives each turn its own generation (`myEpoch`, captured the instant the
 * turn becomes active). `clearSession` bumps `turnEpoch`, advancing the
 * generation; the turn-loop `finally` only clears the shared fields while
 * `this.turnEpoch === myEpoch`, so a stale `finally` from an ended generation is a
 * no-op and never touches the new session. These tests reproduce the
 * cross-generation interleave deterministically by deferring the stale turn's
 * `finally` until AFTER the new session is created and a new turn is running.
 */

// --- a controllable turn whose `finally` settles on demand -------------------

/**
 * A stand-in for `runTurn` whose cleanup (`finally`) can be deferred to an
 * explicit moment, so a test can interleave a brand-new session/turn between the
 * `end`/cancel and the stale turn's late `finally` — exactly the cross-generation
 * window the P2 lives in.
 *
 * `next()` parks at a per-chunk gate (a real turn at an STT/LLM/TTS `await`).
 * `return()` (the DO's cancel) does not finish until a deferred `settleReturn()`
 * is called — modelling the real "`return()` cannot run the `finally` until the
 * pending provider promise settles". When it does settle, the generator runs its
 * `finally` (mirrors `runTurn` closing the queue + returning the live iterators).
 */
function makeDeferredTurn(chunks: AiResponseChunk[]): {
  generator: AsyncGenerator<AiResponseChunk>
  /** Advance one chunk: resolve the gate so the parked turn yields its next. */
  releaseNext: () => void
  /** Settle the deferred `return()` so the generator unwinds and runs `finally`. */
  settleReturn: () => void
  /** True once the generator's `finally` ran. */
  cleanedUp: () => boolean
  /** True once the generator reached its settle step (turn fully completed). */
  settled: () => boolean
} {
  let cleaned = false
  let didSettle = false
  let canceled = false
  let returnSettled = false
  let chunkGate: (() => void) | undefined
  let returnGate: (() => void) | undefined

  const waitChunk = (): Promise<void> =>
    new Promise<void>((resolve) => {
      chunkGate = resolve
    })
  const wakeChunk = (): void => {
    const g = chunkGate
    chunkGate = undefined
    g?.()
  }
  // Latched: if `settleReturn` already fired before the generator parks at the
  // return gate, the wait resolves immediately rather than blocking forever.
  const waitReturn = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (returnSettled) {
        resolve()
        return
      }
      returnGate = resolve
    })
  const wakeReturn = (): void => {
    returnSettled = true
    const g = returnGate
    returnGate = undefined
    g?.()
  }

  async function* gen(): AsyncGenerator<AiResponseChunk> {
    try {
      for (const chunk of chunks) {
        await waitChunk()
        if (canceled) break
        yield chunk
      }
      if (!canceled) didSettle = true
    } finally {
      // Cancel path: the `return()` is held here until the test settles it,
      // modelling the late provider-promise settle that finally lets the
      // generator's cleanup run. The normal-completion path skips the wait.
      if (canceled) await waitReturn()
      cleaned = true
    }
  }

  return {
    generator: gen(),
    releaseNext: wakeChunk,
    settleReturn: () => {
      canceled = true
      // Wake the parked chunk gate so the loop observes cancellation and falls
      // into `finally`, then release the `finally`'s return gate.
      wakeChunk()
      wakeReturn()
    },
    cleanedUp: () => cleaned,
    settled: () => didSettle,
  }
}

// --- a faithful DO control-dispatch stand-in (with the epoch guard) ----------

interface OutboundMessage {
  type: string
  [k: string]: unknown
}

interface SharedBridge {
  closed: boolean
}

/**
 * Mirrors `VoiceSessionDO.handleControl` for `create` / `turn` / `end` plus the
 * owner branch of `onSocketClose`, the `clearSession` reset (which bumps
 * `turnEpoch`), and the EPOCH-GUARDED turn-loop `finally`. It holds the same
 * session-level fields the real DO has, including `turnEpoch`. The single owner
 * socket is implicit (ownership isolation is covered in `session-identity.test.ts`).
 */
class FakeSessionDo {
  state: { history: string[]; turnCount: number } | undefined
  userId: string | undefined
  providers: object | undefined
  turnInFlight = false
  activeTurn: AsyncIterator<AiResponseChunk> | undefined
  bridge: SharedBridge | undefined
  /** Monotonic session generation — the epoch guard (mirrors `turnEpoch`). */
  turnEpoch = 0
  readonly sent: OutboundMessage[] = []

  /** Per-call turn supplier so distinct sessions get distinct turn generators. */
  constructor(private turnFactory: () => AsyncGenerator<AiResponseChunk>) {}

  setTurnFactory(factory: () => AsyncGenerator<AiResponseChunk>): void {
    this.turnFactory = factory
  }

  private send(msg: OutboundMessage): void {
    this.sent.push(msg)
  }

  /** Mirrors the `create` branch: reject a re-create while a session is live. */
  create(userId: string, initialState: { history: string[]; turnCount: number }): boolean {
    if (this.state) {
      this.send({ type: 'error', code: 'already_created', message: 'session already created' })
      return false
    }
    this.state = initialState
    this.userId = userId
    this.providers = {}
    this.send({ type: 'created' })
    return true
  }

  /**
   * Mirrors the post-fix `turn` branch: guard, hold the iterator, capture
   * `myEpoch` at the same synchronous point the shared fields are set, drive the
   * loop, and clear the guard in `finally` ONLY while this turn is still the live
   * generation (`this.turnEpoch === myEpoch`). Returns the loop promise so a test
   * can interleave other messages while it is in flight.
   */
  async turn(): Promise<void> {
    if (!this.state || !this.userId) {
      this.send({ type: 'error', code: 'turn_before_create', message: 'turn before create' })
      return
    }
    if (this.turnInFlight) {
      this.send({ type: 'error', code: 'turn_in_flight', message: 'a turn is already in progress' })
      return
    }
    const turn = this.turnFactory()[Symbol.asyncIterator]()
    const myEpoch = this.turnEpoch
    this.activeTurn = turn
    this.turnInFlight = true
    try {
      for (;;) {
        const next = await turn.next()
        if (next.done) break
        const chunk = next.value
        this.send({ type: 'chunk', kind: chunk.kind, done: chunk.done, text: chunk.text })
      }
    } finally {
      // Epoch guard: only release if THIS turn is still the live generation.
      if (this.turnEpoch === myEpoch) {
        this.turnInFlight = false
        this.activeTurn = undefined
      }
    }
  }

  /**
   * Mirrors the post-fix `end` branch: close the bridge, cancel the in-flight
   * turn FIRE-AND-FORGET (no await), CLEAR the bound session (bumping the epoch),
   * and summarize. A no-session `end` is a no-op.
   */
  end(): void {
    if (!this.state || !this.userId) return
    const turnCount = this.state.turnCount
    this.closeBridge()
    void this.cancelActiveTurn()
    this.clearSession()
    this.send({ type: 'summary', turnCount })
  }

  /** Mirrors `onSocketClose` owner branch (post-fix): cancel, then clear (epoch bump). */
  ownerClose(): void {
    this.closeBridge()
    void this.cancelActiveTurn()
    this.clearSession()
  }

  private closeBridge(): void {
    if (this.bridge) this.bridge.closed = true
  }

  /** Mirrors `cancelActiveTurn`: capture the live iterator synchronously, then `return()`. */
  private async cancelActiveTurn(): Promise<void> {
    const turn = this.activeTurn
    if (turn === undefined) return
    await turn.return?.(undefined)
  }

  /** Mirrors `clearSession`: bump the epoch FIRST, then reset every session field. */
  private clearSession(): void {
    this.turnEpoch += 1
    this.state = undefined
    this.userId = undefined
    this.providers = undefined
    this.bridge = undefined
    this.turnInFlight = false
    this.activeTurn = undefined
  }
}

// --- helpers -----------------------------------------------------------------

const textChunk = (text: string, done = false): AiResponseChunk => ({ kind: 'text', text, done })

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

// --- the cross-generation race: stale finally must NOT clobber the new session --

describe('epoch guard — a stale turn finally does not clobber a new session (P2)', () => {
  it('end mid-turn → reconnect create + new turn → stale finally settles late and is a no-op', async () => {
    // Generation 1: an owner session with a turn parked mid-flight at a provider
    // await (the cancel cannot settle until we say so).
    const gen1 = makeDeferredTurn([textChunk('g1-partial'), textChunk('', true)])
    const do_ = new FakeSessionDo(() => gen1.generator)
    do_.create('user-A', { history: [], turnCount: 0 })
    do_.bridge = { closed: false }

    const turning1 = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(do_.activeTurn).toBe(gen1.generator)
    const epoch1 = do_.turnEpoch

    // Owner ends mid-turn: fire-and-forget cancel, clearSession bumps the epoch.
    // The gen-1 turn loop's `finally` has NOT run yet (its `return()` is parked
    // on the deferred provider settle).
    do_.end()
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
    expect(do_.state).toBeUndefined()
    expect(do_.turnEpoch).toBe(epoch1 + 1)
    expect(gen1.cleanedUp()).toBe(false)

    // A client reconnects to the SAME-named DO and opens a fresh session, then
    // starts a NEW turn. This is generation 2: fresh turnInFlight/activeTurn.
    const gen2 = makeDeferredTurn([textChunk('g2-partial'), textChunk('', true)])
    do_.setTurnFactory(() => gen2.generator)
    expect(do_.create('user-B', { history: [], turnCount: 0 })).toBe(true)
    do_.bridge = { closed: false }
    const turning2 = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(do_.activeTurn).toBe(gen2.generator)
    const epoch2 = do_.turnEpoch

    // NOW the gen-1 turn's deferred `return()` finally settles and its `finally`
    // runs — LATE, after gen 2 is live. The epoch guard must make it a no-op.
    gen1.settleReturn()
    await turning1
    expect(gen1.cleanedUp()).toBe(true)
    expect(gen1.settled()).toBe(false)

    // (1) The new session's overlap guard is STILL set — the stale finally did
    // not reopen it.
    expect(do_.turnInFlight).toBe(true)
    // (2) The new session's activeTurn is STILL the gen-2 iterator — the stale
    // finally did not null it out (so gen 2 stays cancelable by end).
    expect(do_.activeTurn).toBe(gen2.generator)
    expect(do_.turnEpoch).toBe(epoch2)

    // (3) Overlap guard still rejects an overlapping turn ON THE NEW SESSION.
    await do_.turn()
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })

    // (4) The new turn is still cancelable by end — its activeTurn survived, so
    // end can drive its return() and clear the (gen-2) session.
    do_.end()
    expect(do_.state).toBeUndefined()
    expect(do_.sent.filter((m) => m.type === 'summary')).toHaveLength(2)

    // Drain gen 2's deferred cleanup so nothing is left pending.
    gen2.settleReturn()
    await turning2
    expect(gen2.cleanedUp()).toBe(true)
  })

  it('owner abrupt close mid-turn → reconnect + new turn → stale finally is a no-op', async () => {
    const gen1 = makeDeferredTurn([textChunk('g1'), textChunk('', true)])
    const do_ = new FakeSessionDo(() => gen1.generator)
    do_.create('user-A', { history: [], turnCount: 0 })
    do_.bridge = { closed: false }

    const turning1 = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)

    // Owner socket drops WITHOUT `end`: cancel fire-and-forget + clearSession
    // (epoch bump). gen-1 finally still parked.
    do_.ownerClose()
    expect(do_.state).toBeUndefined()
    expect(gen1.cleanedUp()).toBe(false)

    // Reconnect: fresh session + new turn (generation 2).
    const gen2 = makeDeferredTurn([textChunk('g2'), textChunk('', true)])
    do_.setTurnFactory(() => gen2.generator)
    expect(do_.create('user-A', { history: [], turnCount: 0 })).toBe(true)
    do_.bridge = { closed: false }
    const turning2 = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(do_.activeTurn).toBe(gen2.generator)

    // gen-1's late `finally` runs after gen 2 is live: must be a no-op.
    gen1.settleReturn()
    await turning1

    expect(do_.turnInFlight).toBe(true)
    expect(do_.activeTurn).toBe(gen2.generator)
    await do_.turn()
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })

    // cleanup
    gen2.settleReturn()
    await turning2
    expect(gen2.cleanedUp()).toBe(true)
  })
})

// --- normal single-session flow must not regress -----------------------------

describe('epoch guard — normal single-session flow is unchanged (no interleave)', () => {
  it('a turn that completes within its own live session clears the guard as before', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const controls: ReturnType<typeof makeDeferredTurn>[] = []
    const do_ = new FakeSessionDo(() => {
      const ctrl = makeDeferredTurn([textChunk('hi'), textChunk('', true)])
      controls.push(ctrl)
      return ctrl.generator
    })
    do_.create('user-A', sharedState)
    do_.bridge = { closed: false }
    const startEpoch = do_.turnEpoch

    const t1 = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    // Drive both chunks to normal completion — no end, no interleave.
    controls[0].releaseNext()
    await tick()
    controls[0].releaseNext()
    await t1

    // Normal completion: the epoch never advanced, so the (current-generation)
    // finally cleared the guard exactly as before.
    expect(controls[0].settled()).toBe(true)
    expect(controls[0].cleanedUp()).toBe(true)
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()
    expect(do_.turnEpoch).toBe(startEpoch)

    // A subsequent turn in the SAME session runs normally (guard was released).
    const t2 = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(controls).toHaveLength(2)
    controls[1].releaseNext()
    await tick()
    controls[1].releaseNext()
    await t2
    expect(do_.turnInFlight).toBe(false)
    expect(do_.turnEpoch).toBe(startEpoch)
  })

  it('overlap guard still rejects an overlapping turn within one live session', async () => {
    let turnsStarted = 0
    const controls: ReturnType<typeof makeDeferredTurn>[] = []
    const do_ = new FakeSessionDo(() => {
      turnsStarted += 1
      const ctrl = makeDeferredTurn([textChunk('A'), textChunk('', true)])
      controls.push(ctrl)
      return ctrl.generator
    })
    do_.create('user-A', { history: [], turnCount: 0 })
    do_.bridge = { closed: false }

    const firstTurn = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(turnsStarted).toBe(1)

    // Overlapping turn while the first is parked: rejected, no second turn starts.
    await do_.turn()
    expect(turnsStarted).toBe(1)
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })

    // cleanup — drive the first turn to completion.
    controls[0].releaseNext()
    await tick()
    controls[0].releaseNext()
    await firstTurn
    expect(do_.turnInFlight).toBe(false)
  })

  it('end with no interleave still cancels + clears (single-session end path intact)', async () => {
    const gen1 = makeDeferredTurn([textChunk('partial'), textChunk('', true)])
    const do_ = new FakeSessionDo(() => gen1.generator)
    do_.create('user-A', { history: [], turnCount: 0 })
    do_.bridge = { closed: false }

    const turning = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)

    // End mid-turn, NO reconnect: summary out, state cleared, epoch bumped.
    do_.end()
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
    expect(do_.state).toBeUndefined()
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()

    // The stale finally settles late with no new session present: still a no-op,
    // and the already-cleared fields stay cleared (no revival).
    gen1.settleReturn()
    await turning
    expect(gen1.cleanedUp()).toBe(true)
    expect(gen1.settled()).toBe(false)
    expect(do_.state).toBeUndefined()
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()

    // A post-end create-less turn is still rejected (cleanup contract intact).
    await do_.turn()
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_before_create',
      message: 'turn before create',
    })
  })
})
