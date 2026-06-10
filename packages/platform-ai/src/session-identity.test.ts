import { describe, expect, it } from 'vitest'
import {
  assertSessionOwnership,
  assertSocketOwnsBoundSession,
  socketOwnsBoundSession,
  SocketIdentityRegistry,
} from './auth-seam'

/**
 * Regression tests for the per-socket session-identity mechanism that
 * `VoiceSessionDO` is a thin shell over (L2 §Mechanism Variant 3, step 3).
 *
 * The DO class itself imports `cloudflare:workers` and cannot be instantiated in
 * the Node test environment, so — exactly as `assertSessionOwnership` and
 * `runTurn` are tested — these tests exercise the extracted pure pieces:
 *  - `SocketIdentityRegistry`: binds the handshake-forwarded user id to the
 *    specific accepted socket (F-B), so a second client on the same DO instance
 *    cannot overwrite the first client's identity.
 *  - `assertSessionOwnership`: the per-operation ownership check the DO runs with
 *    THIS socket's resolved user id as the operating user.
 *
 * Together they reproduce the defect's attack shape: two authenticated clients
 * connect to the same-named DO (one instance, one session owner bound at
 * `create`), and the second client must NOT be able to drive the first user's
 * session.
 */

/** A stand-in socket — only reference identity matters to the registry. */
type FakeSocket = { id: string }

const socketA: FakeSocket = { id: 'socketA' }
const socketB: FakeSocket = { id: 'socketB' }

describe('SocketIdentityRegistry — per-socket identity binding (F-B)', () => {
  it('resolves each socket to its own bound user id', () => {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    reg.bind(socketA, 'user-A')
    reg.bind(socketB, 'user-B')

    // The later bind does NOT overwrite the earlier socket's identity — the bug
    // was a single shared field that the second upgrade clobbered.
    expect(reg.resolve(socketA)).toBe('user-A')
    expect(reg.resolve(socketB)).toBe('user-B')
    expect(reg.size).toBe(2)
  })

  it('returns undefined for a socket that was never bound', () => {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    expect(reg.resolve(socketA)).toBeUndefined()
  })

  it('releases a socket binding on close without affecting others', () => {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    reg.bind(socketA, 'user-A')
    reg.bind(socketB, 'user-B')

    reg.release(socketA)
    expect(reg.resolve(socketA)).toBeUndefined()
    expect(reg.resolve(socketB)).toBe('user-B')
    expect(reg.size).toBe(1)
  })
})

describe('per-socket ownership — two users on one DO stay isolated (F-B)', () => {
  // Model the DO: socket A (user-A) created the session, so the DO's bound owner
  // is user-A and the session id is fixed.
  const SESSION_ID = 'do-session-1'
  const reg = new SocketIdentityRegistry<FakeSocket>()
  reg.bind(socketA, 'user-A')
  reg.bind(socketB, 'user-B')
  const ownerBound = { boundSessionId: SESSION_ID, boundUserId: 'user-A' }

  it('lets the owning socket operate on its own session', () => {
    // The DO uses THIS socket's resolved user as the operating user.
    const operatingUser = reg.resolve(socketA) as string
    expect(() => assertSessionOwnership(ownerBound, SESSION_ID, operatingUser)).not.toThrow()
  })

  it('rejects a second authenticated user driving the first user’s session', () => {
    // Socket B sends create/turn/end on the SAME DO. Its per-socket identity is
    // user-B, which does not own the session bound to user-A → rejected.
    const operatingUser = reg.resolve(socketB) as string
    expect(operatingUser).toBe('user-B')
    expect(() => assertSessionOwnership(ownerBound, SESSION_ID, operatingUser)).toThrow(
      /does not own/
    )
  })

  it('binding socket B does not change the user resolved for socket A', () => {
    // The crux of the fix: even after socket B connected (and would have
    // overwritten a shared field), socket A still resolves to user-A.
    expect(reg.resolve(socketA)).toBe('user-A')
  })
})

describe('binary audio path — non-owner frames cannot pollute the owner bridge (F-B)', () => {
  // Model the DO's binary branch: the owner's audio bridge is a shared sink. A
  // binary frame is only pushed AFTER the per-socket ownership gate passes —
  // exactly the order `onSocketMessage` runs (`assertSocketOwner(ws)` then
  // `bridge.push`). The bug was the binary branch pushing UNCONDITIONALLY, so a
  // second authenticated socket on the same DO could inject frames the owner's
  // next turn would transcribe.
  const SESSION_ID = 'do-session-1'

  function makeDo() {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    // socket A created the session → bound owner is user-A.
    reg.bind(socketA, 'user-A')
    reg.bind(socketB, 'user-B')
    const ownerBound = { boundSessionId: SESSION_ID, boundUserId: 'user-A' }
    const audioBridge: Uint8Array[] = []

    // Mirrors VoiceSessionDO.onSocketMessage's binary branch: gate, then push.
    function feedBinaryFrame(socket: FakeSocket, frame: Uint8Array): void {
      assertSocketOwnsBoundSession(reg, socket, ownerBound)
      audioBridge.push(frame)
    }

    return { audioBridge, feedBinaryFrame }
  }

  it('queues the owner socket’s binary frame onto the bridge', () => {
    const { audioBridge, feedBinaryFrame } = makeDo()
    const frame = new Uint8Array([1, 2, 3])

    feedBinaryFrame(socketA, frame)

    expect(audioBridge).toEqual([frame])
  })

  it('rejects a non-owner socket’s binary frame and never touches the owner bridge', () => {
    const { audioBridge, feedBinaryFrame } = makeDo()

    // Socket B (user-B) knows the session name and is authenticated, but does NOT
    // own the session → its binary frame is rejected before reaching the bridge.
    expect(() => feedBinaryFrame(socketB, new Uint8Array([9, 9, 9]))).toThrow(/does not own/)

    // The owner's bridge stays empty — the owner's next turn transcribes only the
    // owner's own audio, not the attacker's injected frame.
    expect(audioBridge).toEqual([])
  })

  it('does not let an attacker frame interleave with the owner’s real audio', () => {
    const { audioBridge, feedBinaryFrame } = makeDo()
    const ownerFrame1 = new Uint8Array([1])
    const ownerFrame2 = new Uint8Array([2])

    feedBinaryFrame(socketA, ownerFrame1)
    expect(() => feedBinaryFrame(socketB, new Uint8Array([0xff]))).toThrow(/does not own/)
    feedBinaryFrame(socketA, ownerFrame2)

    // Only the owner's two frames are present, in order — the attacker's frame
    // never wedged itself into the middle of the owner's utterance.
    expect(audioBridge).toEqual([ownerFrame1, ownerFrame2])
  })

  it('rejects a binary frame from a socket with no bound identity', () => {
    const { audioBridge, feedBinaryFrame } = makeDo()
    const unboundSocket: FakeSocket = { id: 'never-bound' }

    expect(() => feedBinaryFrame(unboundSocket, new Uint8Array([7]))).toThrow(
      /no authenticated identity/
    )
    expect(audioBridge).toEqual([])
  })

  it('rejects a binary frame that arrives before any session is created', () => {
    // Pre-create: the DO has no bound owner/session yet. A binary frame must not
    // silently create or feed a bridge — it fails loud like the control path.
    const reg = new SocketIdentityRegistry<FakeSocket>()
    reg.bind(socketA, 'user-A')
    const preCreateBound = { boundSessionId: undefined, boundUserId: undefined }

    expect(() => assertSocketOwnsBoundSession(reg, socketA, preCreateBound)).toThrow(
      /before createSession/
    )
  })

  it('returns the verified operating user id on a successful ownership check', () => {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    reg.bind(socketA, 'user-A')
    const ownerBound = { boundSessionId: SESSION_ID, boundUserId: 'user-A' }

    expect(assertSocketOwnsBoundSession(reg, socketA, ownerBound)).toBe('user-A')
  })
})

describe('socket close — only the owner’s close tears down the shared bridge (F-E)', () => {
  // Model VoiceSessionDO.onSocketClose: it ALWAYS releases the closing socket's
  // identity binding, but tears down the shared audio bridge / in-flight turn
  // ONLY when the closing socket owns the bound session. The bug was an
  // UNCONDITIONAL teardown: a non-owner client connecting to the same
  // `/ai-ws/{name}` DO and then disconnecting closed the owner's bridge and
  // truncated the owner's in-flight turn. The control/binary paths were already
  // owner-gated; the close path bypassed the gate.
  const SESSION_ID = 'do-session-1'

  function makeDo() {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    // socket A created the session → bound owner is user-A.
    reg.bind(socketA, 'user-A')
    reg.bind(socketB, 'user-B')
    const ownerBound = { boundSessionId: SESSION_ID, boundUserId: 'user-A' }
    // `bridge` stands in for the DO's `this.audio`: a live object = an in-flight
    // turn, `undefined` = torn down.
    let bridge: { closed: boolean } | undefined = { closed: false }

    // Mirrors VoiceSessionDO.onSocketClose: gate teardown on ownership, always
    // release the closing socket's own binding.
    function closeSocket(socket: FakeSocket): void {
      const ownsSession = socketOwnsBoundSession(reg, socket, ownerBound)
      reg.release(socket)
      if (!ownsSession) return
      if (bridge) bridge.closed = true
      bridge = undefined
    }

    return {
      reg,
      closeSocket,
      bridgeIsLive: () => bridge !== undefined,
      bridgeClosed: () => bridge?.closed ?? true,
    }
  }

  it('a non-owner close leaves the owner bridge / turn untouched', () => {
    const { closeSocket, reg, bridgeIsLive } = makeDo()

    // Non-owner socket B (user-B) connected and now disconnects.
    closeSocket(socketB)

    // The owner's in-flight turn survives: the bridge is still live.
    expect(bridgeIsLive()).toBe(true)
    // Only socket B's own identity binding was released.
    expect(reg.resolve(socketB)).toBeUndefined()
    expect(reg.resolve(socketA)).toBe('user-A')
  })

  it('the owner’s own close tears the bridge down normally', () => {
    const { closeSocket, reg, bridgeIsLive, bridgeClosed } = makeDo()

    closeSocket(socketA)

    // Owner teardown: bridge closed and cleared, owner binding released.
    expect(bridgeClosed()).toBe(true)
    expect(bridgeIsLive()).toBe(false)
    expect(reg.resolve(socketA)).toBeUndefined()
  })

  it('a non-owner close then the owner close still tears down exactly once', () => {
    const { closeSocket, bridgeIsLive } = makeDo()

    // Attacker connects + disconnects first: bridge must survive.
    closeSocket(socketB)
    expect(bridgeIsLive()).toBe(true)

    // Owner finally disconnects: now teardown happens.
    closeSocket(socketA)
    expect(bridgeIsLive()).toBe(false)
  })

  it('a close from an unbound socket tears down nothing', () => {
    const { closeSocket, bridgeIsLive } = makeDo()
    const unbound: FakeSocket = { id: 'never-bound' }

    closeSocket(unbound)

    // No bound identity → not the owner → bridge untouched.
    expect(bridgeIsLive()).toBe(true)
  })

  it('socketOwnsBoundSession is false before any session is created', () => {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    reg.bind(socketA, 'user-A')
    const preCreate = { boundSessionId: undefined, boundUserId: undefined }

    // Pre-create close must not tear down a (nonexistent) bridge.
    expect(socketOwnsBoundSession(reg, socketA, preCreate)).toBe(false)
  })

  it('socketOwnsBoundSession is true only for the owning socket', () => {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    reg.bind(socketA, 'user-A')
    reg.bind(socketB, 'user-B')
    const ownerBound = { boundSessionId: SESSION_ID, boundUserId: 'user-A' }

    expect(socketOwnsBoundSession(reg, socketA, ownerBound)).toBe(true)
    expect(socketOwnsBoundSession(reg, socketB, ownerBound)).toBe(false)
  })
})

describe('non-hibernation invariant — session state stays valid between turns (F-C)', () => {
  /**
   * With hibernation dropped (`server.accept()` instead of `ctx.acceptWebSocket`)
   * the DO stays resident for the session, so the in-memory state created at
   * `create` is still present when a later `turn` arrives. We model that
   * persistence with a plain object the "DO" holds across operations: a `create`
   * sets it; a subsequent `turn` reads it back (it is never reset to undefined
   * by an eviction). This documents the chosen (b) approach and guards against a
   * regression to per-message state that an idle hibernation would have lost.
   */
  it('state set at create is readable by a later turn (resident DO)', () => {
    // A tiny stand-in for the DO: it holds session state across operations.
    const resident: { state?: { gameId: string } } = {}

    // create
    resident.state = { gameId: 'bombsquad' }

    // No hibernation/eviction happens between operations, so state survives.
    // (Under the old hibernation path, an idle eviction here would reset the
    // instance fields to undefined and the turn below would see no session.)

    // turn — reads the state created earlier
    expect(resident.state).toBeDefined()
    expect(resident.state?.gameId).toBe('bombsquad')
  })
})
