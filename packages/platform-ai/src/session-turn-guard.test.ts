import { describe, expect, it } from 'vitest'
import type { AiResponseChunk } from './contract'

/**
 * Regression tests for the turn in-flight guard and the DO cross-await reentrancy
 * matrix (the P1 from PR #156 review). `VoiceSessionDO` imports
 * `cloudflare:workers` and cannot be instantiated in the Node test environment, so
 * — exactly as the per-socket identity and `runTurn` mechanisms are tested via
 * their extracted pieces (see `session-identity.test.ts`, `turn-pipeline.test.ts`)
 * — these tests model the DO's control-dispatch logic with a faithful stand-in
 * (`FakeSessionDo`) that mirrors the real fields (`state` / `turnInFlight` /
 * `activeTurn` / `audio`) and the real `handleControl` branches one-for-one.
 *
 * The defect's shape: a DO event can interleave across the many `await`s inside
 * one turn (STT/LLM/TTS all await), so a second `turn` message arriving mid-flight
 * would start a SECOND `runTurn` over the SAME `state`/`providers`/socket — racing
 * shared `history`/`usage` and interleaving two response streams on one socket.
 * The guard rejects the overlap; `end` / owner-close cleanly cancel an in-flight
 * turn. These tests reproduce the interleave deterministically with a controllable
 * async turn generator.
 */

// --- a controllable turn generator -------------------------------------------

/**
 * A stand-in for `runTurn`: an async generator that suspends at a per-chunk gate
 * (modelling a real turn parked at an STT/LLM/TTS `await`), then yields a chunk.
 * While parked at the gate the DO is free to process an interleaved control
 * message — exactly the cross-await interleave the P1 is about. It records whether
 * its `finally` ran (the clean-cancel signal) and mutates a shared `state` so a
 * second concurrent turn would be observable as state corruption.
 *
 * Cancellation mirrors the real pipeline: the DO drives cancel as "close the
 * bridge (which unblocks the STT `await`) THEN `return()`". Here `cancel()`
 * resolves the pending gate (the bridge-close analogue) before the DO's
 * `return()`, so the generator unblocks, observes the return-completion, and runs
 * its `finally` — never hanging on a permanently-pending await.
 */
interface TurnState {
  /** Mirrors `SessionState.history` — a second concurrent turn would race this. */
  history: string[]
  /** Mirrors `SessionState.turnCount` — only a fully-completed turn increments it. */
  turnCount: number
}

interface SharedBridge {
  closed: boolean
}

function makeControllableTurn(
  state: TurnState,
  bridge: SharedBridge,
  chunks: AiResponseChunk[]
): {
  generator: AsyncGenerator<AiResponseChunk>
  /** Resolve the pending gate so the generator advances to its next yield. */
  releaseNext: () => void
  /** Bridge-close analogue: unblock any pending gate so `return()` can unwind. */
  cancel: () => void
  /** True once the generator's `finally` ran (normal completion OR cancellation). */
  cleanedUp: () => boolean
  /** True once the generator reached its settle step (turn fully completed). */
  settled: () => boolean
} {
  let cleaned = false
  let didSettle = false
  let canceled = false
  let gate: (() => void) | undefined
  const waitGate = (): Promise<void> =>
    new Promise<void>((resolve) => {
      gate = resolve
    })
  const wake = (): void => {
    const g = gate
    gate = undefined
    g?.()
  }

  async function* gen(): AsyncGenerator<AiResponseChunk> {
    try {
      for (const chunk of chunks) {
        // Park at the gate — a real turn is suspended at an STT/LLM/TTS await
        // here, which is exactly when the DO would process an interleaved event.
        await waitGate()
        // Bridge-close analogue: once the bridge is closed (cancel), the STT
        // step yields no more input, so the turn stops producing — it exits the
        // loop and lets the `finally` unwind (no further chunks, no settle).
        if (canceled) break
        // Mutate shared state as a real turn does; a second concurrent turn
        // racing this is the corruption the guard prevents.
        if (chunk.kind === 'text' && chunk.text) state.history.push(chunk.text)
        yield chunk
      }
      // Settle step (mirrors runTurn's tail): only reached on normal completion.
      if (!canceled) {
        didSettle = true
        state.turnCount += 1
      }
    } finally {
      // Runs on normal completion AND on an upstream `return()` (cancellation):
      // mirrors runTurn closing the sentence queue + returning the LLM/TTS
      // iterators. Closing the bridge here stands in for STT termination.
      cleaned = true
      bridge.closed = true
    }
  }

  return {
    generator: gen(),
    // Advance one chunk: resolve the gate so the parked turn yields its next.
    releaseNext: wake,
    // Bridge-close analogue: flag cancellation, then wake the parked gate so the
    // turn observes it, stops producing, and unwinds (the DO's `return()` then
    // settles cleanly without the turn re-parking).
    cancel: () => {
      canceled = true
      wake()
    },
    cleanedUp: () => cleaned,
    settled: () => didSettle,
  }
}

// --- a faithful DO control-dispatch stand-in ---------------------------------

interface OutboundMessage {
  type: string
  [k: string]: unknown
}

/**
 * Mirrors `VoiceSessionDO.handleControl` for the three control messages, holding
 * the same fields and running the same guard / cancel logic. `turnFactory`
 * supplies the controllable turn generator in place of `onAiResponse`. The single
 * owner socket is implicit (ownership is covered in `session-identity.test.ts`);
 * here we isolate the reentrancy matrix.
 */
class FakeSessionDo {
  state: { history: string[]; turnCount: number } | undefined
  turnInFlight = false
  activeTurn: AsyncIterator<AiResponseChunk> | undefined
  bridge: SharedBridge | undefined
  /**
   * Unblock-the-STT-await hook for the in-flight turn — the test wires it to the
   * controllable turn's `cancel()`. Mirrors the real `this.audio.close()`:
   * closing the bridge resolves the STT step's pending `await` so a subsequent
   * `return()` can unwind the parked generator (an async generator's `return()`
   * cannot interrupt a still-pending `await`). Reset to `undefined` between turns.
   */
  onBridgeClose: (() => void) | undefined
  readonly sent: OutboundMessage[] = []

  constructor(private readonly turnFactory: () => AsyncGenerator<AiResponseChunk>) {}

  private send(msg: OutboundMessage): void {
    this.sent.push(msg)
  }

  create(initialState: { history: string[]; turnCount: number }): void {
    // Mirrors the `create` branch: reject a re-create while a session is live.
    if (this.state) {
      this.send({ type: 'error', code: 'already_created', message: 'session already created' })
      return
    }
    this.state = initialState
  }

  /**
   * Mirrors the `turn` branch: guard, hold the iterator, mark in-flight BEFORE the
   * first await, drive the loop, clear the guard in `finally`. Returns the loop
   * promise so a test can interleave other messages while it is in flight.
   */
  async turn(): Promise<void> {
    if (!this.state) {
      this.send({ type: 'error', code: 'turn_before_create', message: 'turn before create' })
      return
    }
    if (this.turnInFlight) {
      this.send({ type: 'error', code: 'turn_in_flight', message: 'a turn is already in progress' })
      return
    }
    const turn = this.turnFactory()[Symbol.asyncIterator]()
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
      this.turnInFlight = false
      this.activeTurn = undefined
      this.onBridgeClose = undefined
    }
  }

  /**
   * Mirrors the `end` branch: close the bridge, then cancel the in-flight turn
   * FIRE-AND-FORGET (no await) and summarize + return immediately. Awaiting the
   * cancel would make `end` hang whenever the turn is parked at a provider await
   * that never settles (`return()` cannot interrupt a pending await). The
   * background cancel still completes when that await eventually settles, running
   * the turn's `finally` and clearing the guard via the turn loop's own `finally`.
   */
  end(): void {
    if (!this.state) return
    this.closeBridge()
    void this.cancelActiveTurn()
    this.send({ type: 'summary', turnCount: this.state.turnCount })
  }

  /** Mirrors `onSocketClose` owner branch: cancel in-flight turn + close bridge. */
  async ownerClose(): Promise<void> {
    this.closeBridge()
    await this.cancelActiveTurn()
  }

  /** Mirrors `this.audio.close()`: unblock the STT await, mark the bridge closed. */
  private closeBridge(): void {
    this.onBridgeClose?.()
    if (this.bridge) this.bridge.closed = true
  }

  private async cancelActiveTurn(): Promise<void> {
    const turn = this.activeTurn
    if (turn === undefined) return
    await turn.return?.(undefined)
  }
}

// --- helpers -----------------------------------------------------------------

const textChunk = (text: string, done = false): AiResponseChunk => ({ kind: 'text', text, done })

/** Let microtasks drain so an awaiting loop advances to its next suspension. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

// --- the in-flight turn guard ------------------------------------------------

describe('turn in-flight guard — overlapping turn is rejected (P1)', () => {
  it('rejects a second turn while the first is in flight; no second runTurn starts', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const bridge: SharedBridge = { closed: false }
    let turnsStarted = 0
    const controls: ReturnType<typeof makeControllableTurn>[] = []

    const do_ = new FakeSessionDo(() => {
      turnsStarted += 1
      const ctrl = makeControllableTurn(sharedState, bridge, [textChunk('A'), textChunk('', true)])
      controls.push(ctrl)
      do_.onBridgeClose = ctrl.cancel
      return ctrl.generator
    })
    do_.create(sharedState)
    do_.bridge = bridge

    // First turn starts and parks at its first await (real turn mid-STT/LLM).
    const firstTurn = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(turnsStarted).toBe(1)

    // Owner double-clicks: a second `turn` arrives while the first is parked.
    await do_.turn()

    // Rejected with an explicit signal — NOT a second runTurn, NOT a socket close.
    expect(turnsStarted).toBe(1)
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_in_flight',
      message: 'a turn is already in progress',
    })
    // The shared state is untouched by the rejected turn.
    expect(sharedState.history).toEqual([])

    // Drive the first turn to completion (two chunks → two gate releases).
    controls[0].releaseNext()
    await tick()
    controls[0].releaseNext()
    await firstTurn

    // First turn settled normally: one turn counted, no concurrent pollution.
    expect(controls[0].settled()).toBe(true)
    expect(sharedState.turnCount).toBe(1)
    expect(sharedState.history).toEqual(['A'])
    // Guard cleared so the next turn can run.
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()
  })

  it('clears the guard after a turn so a subsequent turn runs normally', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const bridge: SharedBridge = { closed: false }
    const controls: ReturnType<typeof makeControllableTurn>[] = []
    const do_ = new FakeSessionDo(() => {
      const ctrl = makeControllableTurn(sharedState, bridge, [textChunk('', true)])
      controls.push(ctrl)
      do_.onBridgeClose = ctrl.cancel
      return ctrl.generator
    })
    do_.create(sharedState)
    do_.bridge = bridge

    const t1 = do_.turn()
    await tick()
    controls[0].releaseNext()
    await t1
    expect(do_.turnInFlight).toBe(false)

    // A fresh turn after the first completes is accepted (a real second runTurn).
    const t2 = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(controls).toHaveLength(2)
    controls[1].releaseNext()
    await t2
    expect(sharedState.turnCount).toBe(2)
  })

  it('clears the guard even when the turn throws (exception cannot wedge it shut)', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const bridge: SharedBridge = { closed: false }

    // A turn generator that rejects on its first `next()` (provider error) before
    // producing any chunk — models a provider that throws at the STT/LLM step. It
    // intentionally never yields, hence the scoped rule suppression.
    // eslint-disable-next-line require-yield
    async function* throwingTurn(): AsyncGenerator<AiResponseChunk> {
      throw new Error('provider boom')
    }
    const do_ = new FakeSessionDo(() => throwingTurn())
    do_.create(sharedState)
    do_.bridge = bridge

    await expect(do_.turn()).rejects.toThrow('provider boom')

    // The guard is released despite the throw, so the session is not wedged.
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()

    // A subsequent turn is accepted (not blocked by a stuck guard).
    const recoveredCtrl = makeControllableTurn(sharedState, bridge, [textChunk('', true)])
    const recovered = new FakeSessionDo(() => {
      recovered.onBridgeClose = recoveredCtrl.cancel
      return recoveredCtrl.generator
    })
    recovered.create(sharedState)
    const t = recovered.turn()
    await tick()
    expect(recovered.turnInFlight).toBe(true)
    // (cleanup) drive the parked turn to completion so nothing is left pending.
    recoveredCtrl.releaseNext()
    await t
  })
})

// --- end during a turn cleanly cancels ---------------------------------------

describe('end during a turn — clean cancellation (matrix: end)', () => {
  it('cancels the in-flight turn: bridge closed, streams returned, no settle', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const bridge: SharedBridge = { closed: false }
    const ctrl = makeControllableTurn(sharedState, bridge, [
      textChunk('partial'),
      textChunk('', true),
    ])
    const do_ = new FakeSessionDo(() => {
      do_.onBridgeClose = ctrl.cancel
      return ctrl.generator
    })
    do_.create(sharedState)
    do_.bridge = bridge

    const turning = do_.turn()
    await tick()
    // Let the first chunk through so the turn is genuinely mid-stream.
    ctrl.releaseNext()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(ctrl.settled()).toBe(false)

    // `end` arrives mid-turn: fire-and-forget cancel, immediate summary. The
    // summary lands synchronously, BEFORE the turn's `finally` (the cancel runs
    // in the background) — proving `end` does not block on the cancel.
    do_.end()
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
    expect(bridge.closed).toBe(true)

    // The background cancel then settles (the controllable turn unblocks on the
    // bridge-close analogue), and the turn drains to completion.
    await turning

    // The turn's `finally` ran (LLM/TTS streams returned, queue closed) and the
    // bridge is closed (STT terminated) — nothing left dangling.
    expect(ctrl.cleanedUp()).toBe(true)
    expect(bridge.closed).toBe(true)
    // The canceled turn never reached settle, so it did not count.
    expect(ctrl.settled()).toBe(false)
    expect(sharedState.turnCount).toBe(0)
    // Guard cleared after the background cancellation completes.
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()
    // A summary was still emitted, reflecting only completed turns.
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
  })

  it('end with no turn in flight is a no-op cancel and still summarizes', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const do_ = new FakeSessionDo(() => {
      throw new Error('turn should not start')
    })
    do_.create(sharedState)
    do_.bridge = { closed: false }

    do_.end()
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
  })

  it('does not hang when the in-flight turn is parked at a never-settling provider await (F-J)', async () => {
    // F-J: `AsyncIterator.return()` cannot interrupt a provider `await` already
    // pending inside the generator — the generator reaches its `finally` only when
    // that promise settles. A stuck STT/LLM/TTS provider (a fetch/WS that never
    // resolves) is modelled here by a turn parked at a promise NOTHING resolves —
    // closing the bridge does NOT unblock it (unlike the controllable turn above).
    // If `end` awaited the cancel it would hang forever; the fix makes `end`
    // fire-and-forget, so it must summarize + close promptly regardless.
    const sharedState = { history: [] as string[], turnCount: 0 }
    let finallyRan = false
    let stuckReturnAwaited = false

    // A turn generator that parks at a never-settling await on its first `next()`.
    // `return()` on it queues a completion but cannot run the `finally` until the
    // pending await settles — which never happens here.
    async function* stuckTurn(): AsyncGenerator<AiResponseChunk> {
      try {
        await new Promise<void>(() => {
          // Intentionally never resolves: models a stuck provider promise.
        })
        yield textChunk('unreachable')
      } finally {
        finallyRan = true
      }
    }

    const do_ = new FakeSessionDo(() => stuckTurn())
    do_.create(sharedState)
    do_.bridge = { closed: false }
    // Wrap the active turn's `return()` so we can confirm the cancel was initiated
    // (fire-and-forget) yet never settles — exactly the hang `end` must not await.
    const turning = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    const realReturn = do_.activeTurn?.return?.bind(do_.activeTurn)
    if (do_.activeTurn && realReturn) {
      do_.activeTurn.return = (value?: unknown) => {
        stuckReturnAwaited = true
        return realReturn(value)
      }
    }

    // `end` must resolve PROMPTLY even though the turn's cancel can never settle.
    // Race it against a timer; `end()` returning + the summary landing must win.
    const ended = (async () => {
      do_.end()
      return 'ended' as const
    })()
    const timed = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 200))
    const outcome = await Promise.race([ended, timed])

    expect(outcome).toBe('ended')
    // Summary emitted + cancel initiated, but the stuck turn's `finally` did NOT
    // run (the provider await is still pending) — proving `end` never blocked on it.
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
    expect(stuckReturnAwaited).toBe(true)
    expect(finallyRan).toBe(false)
    // The bridge was still closed synchronously by `end` (best-effort teardown).
    expect(do_.bridge?.closed).toBe(true)

    // `turning` stays pending forever (the stuck provider never settles); do not
    // await it. The test asserts only that `end` itself did not hang.
    void turning
  })
})

// --- create during a turn is rejected ----------------------------------------

describe('create during a turn — rejected, session stays active (matrix: create)', () => {
  it('rejects a re-create and does not reset the in-flight session state', async () => {
    const sharedState = { history: ['established'], turnCount: 1 }
    const bridge: SharedBridge = { closed: false }
    const ctrl = makeControllableTurn(sharedState, bridge, [textChunk('', true)])
    const do_ = new FakeSessionDo(() => ctrl.generator)
    do_.create(sharedState)
    do_.bridge = bridge

    const turning = do_.turn()
    await tick()
    expect(do_.turnInFlight).toBe(true)

    // A second `create` arrives mid-turn.
    do_.create({ history: [], turnCount: 0 })

    // Rejected — the live session state is NOT clobbered.
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'already_created',
      message: 'session already created',
    })
    expect(do_.state).toBe(sharedState)
    expect(do_.state?.history).toEqual(['established'])

    // (cleanup) finish the turn.
    ctrl.releaseNext()
    await turning
  })
})

// --- owner socket close during a turn cancels --------------------------------

describe('owner close during a turn — cancels cleanly (matrix: close)', () => {
  it('owner close cancels the in-flight turn and closes the bridge', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const bridge: SharedBridge = { closed: false }
    const ctrl = makeControllableTurn(sharedState, bridge, [textChunk('x'), textChunk('', true)])
    const do_ = new FakeSessionDo(() => {
      do_.onBridgeClose = ctrl.cancel
      return ctrl.generator
    })
    do_.create(sharedState)
    do_.bridge = bridge

    const turning = do_.turn()
    await tick()
    ctrl.releaseNext()
    await tick()
    expect(do_.turnInFlight).toBe(true)

    await do_.ownerClose()
    await turning

    expect(ctrl.cleanedUp()).toBe(true)
    expect(bridge.closed).toBe(true)
    expect(ctrl.settled()).toBe(false)
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()
  })
})
