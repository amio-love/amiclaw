import { describe, expect, it } from 'vitest'
import type { AiResponseChunk } from './contract'

/**
 * Regression tests for post-`end` (and post-owner-close) session-state cleanup
 * (the P2 from PR #156 review). `VoiceSessionDO` imports `cloudflare:workers`
 * and cannot be instantiated in the Node test environment, so — exactly as the
 * per-socket identity, `runTurn`, and turn-guard mechanisms are tested via
 * faithful stand-ins (see `session-identity.test.ts`, `turn-pipeline.test.ts`,
 * `session-turn-guard.test.ts`) — these tests model the DO's control-dispatch
 * logic with a stand-in (`FakeSessionDo`) that mirrors the real fields
 * (`state` / `userId` / `providers` / `turnInFlight` / `activeTurn` / `audio`)
 * and the real `handleControl` `end` / `create` / `turn` branches plus the
 * `clearSession` reset one-for-one.
 *
 * The defect's shape: after the owner sends `end` and gets the summary, the DO
 * kept `state` / `userId` / `providers` bound on the resident (non-hibernating)
 * instance. A later client reconnecting to the SAME-named DO (which only needs
 * the session name) and authenticating as the same user could then:
 *   (a) be wrongly rejected with `already_created` on `create` — the session is
 *       over, a fresh one should open; and worse
 *   (b) send a `turn` with NO new `create`, pass the stale ownership guard, and
 *       run a provider turn on the already-ended session.
 * The fix clears the bound session state at `end` (and at an owner abrupt
 * close), coordinated with the existing fire-and-forget mid-turn cancel.
 */

// --- a controllable turn generator -------------------------------------------

/**
 * Mirror of `session-turn-guard.test.ts`'s controllable turn: an async
 * generator that suspends at a per-chunk gate (a real turn parked at an
 * STT/LLM/TTS `await`), records whether its `finally` ran (the clean-cancel
 * signal) and whether it reached its settle step, and mutates a shared `state`
 * so a turn that wrongly ran on an ended session would be observable.
 */
interface TurnState {
  history: string[]
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
  releaseNext: () => void
  cancel: () => void
  cleanedUp: () => boolean
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
        await waitGate()
        if (canceled) break
        if (chunk.kind === 'text' && chunk.text) state.history.push(chunk.text)
        yield chunk
      }
      if (!canceled) {
        didSettle = true
        state.turnCount += 1
      }
    } finally {
      cleaned = true
      bridge.closed = true
    }
  }

  return {
    generator: gen(),
    releaseNext: wake,
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

/** A stand-in socket — only reference identity matters to the owner-socket gate. */
type FakeWs = { id: string }
/** The socket that opens the session in tests that don't pass one explicitly. */
const OWNER: FakeWs = { id: 'owner-socket' }

/**
 * Mirrors `VoiceSessionDO.handleControl` for `create` / `turn` / `end` plus the
 * owner branch of `onSocketClose` and the `clearSession` reset. It holds the
 * same session-level fields the real DO clears (`state` / `userId` /
 * `providers` / `turnInFlight` / `activeTurn` / `bridge` / `ownerSocket`).
 *
 * Teardown grain (F-W): `end` and owner-close are gated on the OWNER SOCKET
 * reference recorded at `create` (`ownerSocket` / mirrors
 * `socketIsBoundSessionOwner`), not the user id — so a same-user duplicate
 * socket cannot tear the original session down. Tests that don't care about the
 * multi-socket shape omit the socket arg and operate as the `OWNER` socket.
 */
class FakeSessionDo {
  state: { history: string[]; turnCount: number } | undefined
  userId: string | undefined
  providers: object | undefined
  turnInFlight = false
  activeTurn: AsyncIterator<AiResponseChunk> | undefined
  bridge: SharedBridge | undefined
  ownerSocket: FakeWs | undefined
  /** Unblock-the-STT-await hook (the real `this.audio.close()` analogue). */
  onBridgeClose: (() => void) | undefined
  readonly sent: OutboundMessage[] = []

  constructor(private readonly turnFactory: () => AsyncGenerator<AiResponseChunk>) {}

  private send(msg: OutboundMessage): void {
    this.sent.push(msg)
  }

  /** Mirrors `socketIsBoundSessionOwner`: a session is bound AND `ws` is the owner socket. */
  private isOwnerSocket(ws: FakeWs): boolean {
    if (this.state === undefined || this.userId === undefined) return false
    if (this.ownerSocket === undefined) return false
    return ws === this.ownerSocket
  }

  /**
   * Mirrors the `create` branch: reject a re-create while a session is live,
   * otherwise bind the session/user/providers AND record the owner socket.
   * Returns whether a session opened.
   */
  create(
    userId: string,
    initialState: { history: string[]; turnCount: number },
    ws: FakeWs = OWNER
  ): boolean {
    if (this.state) {
      this.send({ type: 'error', code: 'already_created', message: 'session already created' })
      return false
    }
    this.state = initialState
    this.userId = userId
    this.providers = {}
    this.ownerSocket = ws
    this.send({ type: 'created' })
    return true
  }

  /**
   * Mirrors the `turn` branch: `turn before create` if no session (no
   * provider turn starts), the in-flight guard, then drive the loop and clear
   * the guard in `finally`. Returns the loop promise so a test can interleave.
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
   * Mirrors the post-fix `end` branch: a no-session `end` is a no-op (the
   * `if (this.state && socketUserId)` guard); a non-owner-SOCKET `end` is rejected
   * fail-loud (the F-W owner-socket teardown gate) and tears nothing down; only
   * the owner socket's `end` closes the bridge, cancels any in-flight turn
   * FIRE-AND-FORGET (no await), CLEARs the bound session, and summarizes.
   * `clearSession` MUST follow the cancel so the cancel captures the live
   * `activeTurn` before it is reset. Returns whether teardown ran.
   */
  end(ws: FakeWs = OWNER): boolean {
    if (!this.state || !this.userId) return false
    if (!this.isOwnerSocket(ws)) {
      // Same-user duplicate (or any non-owner) socket: reject, do NOT tear down.
      this.send({ type: 'closed', code: 1008, reason: 'end from non-owner socket' })
      return false
    }
    const turnCount = this.state.turnCount
    this.closeBridge()
    void this.cancelActiveTurn()
    this.clearSession()
    this.send({ type: 'summary', turnCount })
    return true
  }

  /**
   * Mirrors `onSocketClose` owner branch (post-fix): cancel in-flight turn, then
   * clear the whole bound session (not just the bridge) so an abrupt owner drop
   * with no `end` leaves no resumable residue.
   */
  async ownerClose(): Promise<void> {
    this.closeBridge()
    const turn = this.activeTurn
    this.clearSession()
    if (turn !== undefined) await turn.return?.(undefined)
  }

  /** Mirrors `this.audio.close()`: unblock the STT await, mark the bridge closed. */
  private closeBridge(): void {
    this.onBridgeClose?.()
    if (this.bridge) this.bridge.closed = true
  }

  /**
   * Mirrors `cancelActiveTurn`: capture the live iterator synchronously, then
   * `return()` it. Captured BEFORE `clearSession` resets `activeTurn`.
   */
  private async cancelActiveTurn(): Promise<void> {
    const turn = this.activeTurn
    if (turn === undefined) return
    await turn.return?.(undefined)
  }

  /** Mirrors `clearSession`: reset every session-level field to its initial value. */
  private clearSession(): void {
    this.state = undefined
    this.userId = undefined
    this.providers = undefined
    this.bridge = undefined
    this.turnInFlight = false
    this.activeTurn = undefined
    this.ownerSocket = undefined
  }
}

// --- helpers -----------------------------------------------------------------

const textChunk = (text: string, done = false): AiResponseChunk => ({ kind: 'text', text, done })

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

// --- post-end: a create-less turn is rejected --------------------------------

describe('post-end cleanup — a turn after end is rejected, no provider turn (P2)', () => {
  it('rejects a turn after end with no new create; the turn factory is never called', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    let turnsStarted = 0
    const do_ = new FakeSessionDo(() => {
      turnsStarted += 1
      throw new Error('a provider turn must not start after end')
    })
    do_.create('user-A', sharedState)
    do_.bridge = { closed: false }

    // Owner ends the session: summary out, state cleared.
    do_.end()
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
    expect(do_.state).toBeUndefined()
    expect(do_.userId).toBeUndefined()
    expect(do_.providers).toBeUndefined()

    // A `turn` arrives on the same DO with NO fresh `create` (a reconnect, or a
    // late frame). It is rejected as "turn before create" — no provider turn.
    await do_.turn()

    expect(turnsStarted).toBe(0)
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_before_create',
      message: 'turn before create',
    })
    // The ended session's state was never resurrected by the rejected turn.
    expect(do_.state).toBeUndefined()
    expect(sharedState.turnCount).toBe(0)
  })
})

// --- post-end: a same-name create opens a clean new session ------------------

describe('post-end cleanup — a create after end opens a fresh session (P2)', () => {
  it('does not reject the post-end create with already_created; binds a new session', () => {
    const firstState = { history: ['old-turn'], turnCount: 3 }
    const do_ = new FakeSessionDo(() => {
      throw new Error('no turn in this test')
    })
    do_.create('user-A', firstState)
    do_.bridge = { closed: false }

    do_.end()
    expect(do_.state).toBeUndefined()

    // Same user reconnects to the same-named DO and creates again. With the stale
    // state cleared, this is NOT rejected as already_created — a clean new
    // session opens, unbound from the previous run's history.
    const opened = do_.create('user-A', { history: [], turnCount: 0 })

    expect(opened).toBe(true)
    expect(do_.sent).not.toContainEqual({
      type: 'error',
      code: 'already_created',
      message: 'session already created',
    })
    expect(do_.state).toEqual({ history: [], turnCount: 0 })
    // The new session does NOT carry the ended run's history.
    expect(do_.state?.history).toEqual([])
  })

  it('still rejects a genuine re-create WHILE a session is live (unchanged behaviour)', () => {
    const do_ = new FakeSessionDo(() => {
      throw new Error('no turn in this test')
    })
    do_.create('user-A', { history: [], turnCount: 0 })

    // No `end` happened — the session is still live, so a second create is the
    // already_created case the prior fix established. Cleanup must not weaken it.
    const opened = do_.create('user-A', { history: [], turnCount: 0 })

    expect(opened).toBe(false)
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'already_created',
      message: 'session already created',
    })
  })
})

// --- post-end with an in-flight turn: cancel + clear, no resurrection ---------

describe('post-end cleanup — end mid-turn cancels, clears, and the background settle is clean (P2 + F-J)', () => {
  it('fire-and-forget cancels the in-flight turn, clears state, and the late settle does not revive the session', async () => {
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
    do_.create('user-A', sharedState)
    do_.bridge = bridge

    const turning = do_.turn()
    await tick()
    ctrl.releaseNext()
    await tick()
    expect(do_.turnInFlight).toBe(true)
    expect(ctrl.settled()).toBe(false)

    // `end` arrives mid-turn: summary lands synchronously and the session state
    // is cleared immediately — BEFORE the background cancel's `finally` runs.
    do_.end()
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 0 })
    expect(do_.state).toBeUndefined()
    expect(do_.userId).toBeUndefined()
    expect(do_.providers).toBeUndefined()
    expect(bridge.closed).toBe(true)

    // The background cancel then settles (the controllable turn unblocks on the
    // bridge-close analogue) and the turn drains to completion WITHOUT error.
    await turning

    // The turn's `finally` ran (streams returned, queue closed); the bridge is
    // closed (STT terminated). The canceled turn never reached settle, so it did
    // not count — and, critically, the late settle did NOT re-bind the session.
    expect(ctrl.cleanedUp()).toBe(true)
    expect(ctrl.settled()).toBe(false)
    expect(sharedState.turnCount).toBe(0)
    expect(do_.state).toBeUndefined()
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()

    // And a post-end turn on the cleared DO is rejected — the ended session
    // cannot be driven even though a turn was mid-flight when `end` arrived.
    await do_.turn()
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_before_create',
      message: 'turn before create',
    })
  })
})

// --- owner abrupt close (no end): same residue, same cleanup -----------------

describe('owner abrupt close — clears the session like end (P2 audit)', () => {
  it('an owner socket drop with no end clears state so a reconnect cannot drive the old session', async () => {
    const sharedState = { history: [] as string[], turnCount: 0 }
    const bridge: SharedBridge = { closed: false }
    let turnsStarted = 0
    const ctrl = makeControllableTurn(sharedState, bridge, [textChunk('x'), textChunk('', true)])
    const do_ = new FakeSessionDo(() => {
      turnsStarted += 1
      do_.onBridgeClose = ctrl.cancel
      return ctrl.generator
    })
    do_.create('user-A', sharedState)
    do_.bridge = bridge

    const turning = do_.turn()
    await tick()
    ctrl.releaseNext()
    await tick()
    expect(do_.turnInFlight).toBe(true)

    // Owner's socket drops WITHOUT sending `end` (network drop / tab close).
    await do_.ownerClose()
    await turning

    // The in-flight turn was cleanly canceled (streams returned, no settle) and
    // the whole session is cleared — not just the bridge.
    expect(ctrl.cleanedUp()).toBe(true)
    expect(ctrl.settled()).toBe(false)
    expect(do_.state).toBeUndefined()
    expect(do_.userId).toBeUndefined()
    expect(do_.providers).toBeUndefined()
    expect(do_.turnInFlight).toBe(false)
    expect(do_.activeTurn).toBeUndefined()

    // A reconnect's create-less turn is rejected (no provider turn runs).
    await do_.turn()
    expect(turnsStarted).toBe(1)
    expect(do_.sent).toContainEqual({
      type: 'error',
      code: 'turn_before_create',
      message: 'turn before create',
    })

    // And a reconnect `create` opens a fresh session (not already_created).
    const opened = do_.create('user-A', { history: [], turnCount: 0 })
    expect(opened).toBe(true)
    expect(do_.state).toEqual({ history: [], turnCount: 0 })
  })
})

// --- F-W: `end` from a same-user NON-OWNER socket must not tear down ----------
//
// `end` is the second teardown trigger (besides owner-close) — it `clearSession`s
// the bound session. `endSession`'s `assertOwner` only checks the user id, so a
// SAME-user second socket (duplicate tab / reconnect) would pass it and tear down
// the still-active original session. The fix gates `end` teardown on the owner
// SOCKET reference: a non-owner socket's `end` (even same user) is rejected
// fail-loud and tears nothing down; the owner's session/turn survive, and the
// owner's own `end` still ends the session normally afterwards.

describe('end teardown gate — only the owner socket can end the session (F-W)', () => {
  const DUP: FakeWs = { id: 'same-user-second-socket' }

  it('a same-user duplicate socket’s end is rejected and clears nothing', () => {
    const do_ = new FakeSessionDo(() => {
      throw new Error('no turn in this test')
    })
    do_.create('user-A', { history: ['live'], turnCount: 2 }) // owner = OWNER socket
    do_.bridge = { closed: false }

    // A second socket for the SAME user (user-A) sends `end`. Owner-socket gate
    // rejects it; no summary, no teardown.
    const tore = do_.end(DUP)

    expect(tore).toBe(false)
    expect(do_.sent).toContainEqual({
      type: 'closed',
      code: 1008,
      reason: 'end from non-owner socket',
    })
    expect(do_.sent).not.toContainEqual({ type: 'summary', turnCount: 2 })
    // The original session is fully intact — state, owner, bridge all untouched.
    expect(do_.state).toEqual({ history: ['live'], turnCount: 2 })
    expect(do_.userId).toBe('user-A')
    expect(do_.ownerSocket).toBe(OWNER)
    expect(do_.bridge?.closed).toBe(false)
  })

  it('after a duplicate socket’s rejected end, the OWNER socket can still end normally', () => {
    const do_ = new FakeSessionDo(() => {
      throw new Error('no turn in this test')
    })
    do_.create('user-A', { history: [], turnCount: 1 })
    do_.bridge = { closed: false }

    // Duplicate's end bounces.
    expect(do_.end(DUP)).toBe(false)
    expect(do_.state).toBeDefined()

    // The real owner socket ends: now the session tears down and summarizes.
    const tore = do_.end(OWNER)
    expect(tore).toBe(true)
    expect(do_.sent).toContainEqual({ type: 'summary', turnCount: 1 })
    expect(do_.state).toBeUndefined()
    expect(do_.ownerSocket).toBeUndefined()
  })

  it('a same-user duplicate socket’s end does not cancel the owner’s in-flight turn', async () => {
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
    do_.create('user-A', sharedState) // owner = OWNER socket
    do_.bridge = bridge

    const turning = do_.turn()
    await tick()
    ctrl.releaseNext()
    await tick()
    expect(do_.turnInFlight).toBe(true)

    // Same-user duplicate socket fires `end` mid-turn: rejected, the in-flight
    // turn keeps running and is NOT canceled.
    expect(do_.end(DUP)).toBe(false)
    expect(do_.turnInFlight).toBe(true)
    expect(ctrl.cleanedUp()).toBe(false)

    // The owner's own turn still completes (and is still cancelable by the OWNER's
    // `end`, which here lets it settle by releasing the remaining chunk first).
    ctrl.releaseNext()
    await tick()
    ctrl.releaseNext()
    await turning
    expect(ctrl.settled()).toBe(true)
    expect(sharedState.turnCount).toBe(1)
  })
})
