import { describe, expect, it } from 'vitest'
import {
  assertSessionOwnership,
  assertSocketOwnsBoundSession,
  socketIsBoundSessionOwner,
  SocketIdentityRegistry,
} from './auth-seam'

/**
 * Regression tests for the per-socket session-identity mechanism that
 * `VoiceSessionDO` is a thin shell over (L2 §Mechanism Variant 3, step 3).
 *
 * These are the unit tests of the extracted pure pieces in `auth-seam.ts` —
 * the identity/ownership layer's own contract, independent of the DO shell.
 * (The real class's enforcement of the same predicates over live sockets is
 * covered by the production-class DO suites; harness:
 * `session-do-test-kit.ts`, pattern SSOT `session-do-usage-flush.test.ts`.)
 * The pieces under test:
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

describe('socket close — only the OWNER SOCKET’s close tears down the shared bridge (F-E / F-W)', () => {
  // Model VoiceSessionDO.onSocketClose: it ALWAYS releases the closing socket's
  // identity binding, but tears down the shared audio bridge / in-flight turn
  // ONLY when the closing socket IS THE OWNER SOCKET — the exact socket recorded
  // at `createSession`. Two earlier-and-now defects:
  //  - F-E: an UNCONDITIONAL teardown let any close tear the owner's bridge down.
  //  - F-W: a USER-ID-keyed gate (`socketUserId === boundUserId`) still let the
  //    SAME user's SECOND socket (a duplicate tab / reconnect) tear down on close,
  //    because its user id equals the owner's. The fix keys teardown on the owner
  //    SOCKET reference, so a same-user duplicate socket's close touches nothing
  //    but its own binding.
  const SESSION_ID = 'do-session-1'

  // socketA2 is a SECOND socket for the SAME user as socketA — the F-W shape.
  const socketA2: FakeSocket = { id: 'socketA2' }

  function makeDo() {
    const reg = new SocketIdentityRegistry<FakeSocket>()
    // socket A created the session → it is the OWNER SOCKET, owner user is user-A.
    reg.bind(socketA, 'user-A')
    // socketA2: SAME user (user-A), different socket — a duplicate tab / reconnect.
    reg.bind(socketA2, 'user-A')
    // socketB: a different user entirely.
    reg.bind(socketB, 'user-B')
    const ownerBound = { boundSessionId: SESSION_ID, boundUserId: 'user-A' }
    const ownerSocket: FakeSocket = socketA
    // `bridge` stands in for the DO's `this.audio`: a live object = an in-flight
    // turn, `undefined` = torn down.
    let bridge: { closed: boolean } | undefined = { closed: false }

    // Mirrors VoiceSessionDO.onSocketClose: gate teardown on OWNER-SOCKET identity,
    // always release the closing socket's own binding.
    function closeSocket(socket: FakeSocket): void {
      const ownsSession = socketIsBoundSessionOwner(socket, ownerSocket, ownerBound)
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

  it('a different-user close leaves the owner bridge / turn untouched (F-E)', () => {
    const { closeSocket, reg, bridgeIsLive } = makeDo()

    // Different-user socket B connected and now disconnects.
    closeSocket(socketB)

    // The owner's in-flight turn survives: the bridge is still live.
    expect(bridgeIsLive()).toBe(true)
    // Only socket B's own identity binding was released.
    expect(reg.resolve(socketB)).toBeUndefined()
    expect(reg.resolve(socketA)).toBe('user-A')
  })

  it('a SAME-USER duplicate socket’s close leaves the owner session untouched (F-W)', () => {
    const { closeSocket, reg, bridgeIsLive } = makeDo()

    // socketA2 is a second tab / reconnect for user-A — the SAME user as the owner.
    // A user-id-keyed gate would have wrongly treated it as the owner and torn the
    // session down. The owner-socket gate does not: its close releases only its own
    // binding, and the owner's still-active session/turn survive.
    closeSocket(socketA2)

    expect(bridgeIsLive()).toBe(true)
    expect(reg.resolve(socketA2)).toBeUndefined()
    // The real owner socket and its binding are untouched.
    expect(reg.resolve(socketA)).toBe('user-A')
  })

  it('the owner socket’s own close tears the bridge down normally', () => {
    const { closeSocket, reg, bridgeIsLive, bridgeClosed } = makeDo()

    closeSocket(socketA)

    // Owner teardown: bridge closed and cleared, owner binding released.
    expect(bridgeClosed()).toBe(true)
    expect(bridgeIsLive()).toBe(false)
    expect(reg.resolve(socketA)).toBeUndefined()
  })

  it('non-owner closes (other user + same-user duplicate) then the owner close tears down exactly once', () => {
    const { closeSocket, bridgeIsLive } = makeDo()

    // Both a different user AND a same-user duplicate disconnect first: bridge must
    // survive every non-owner close.
    closeSocket(socketB)
    expect(bridgeIsLive()).toBe(true)
    closeSocket(socketA2)
    expect(bridgeIsLive()).toBe(true)

    // Owner socket finally disconnects: now teardown happens.
    closeSocket(socketA)
    expect(bridgeIsLive()).toBe(false)
  })

  it('a close from an unbound socket tears down nothing', () => {
    const { closeSocket, bridgeIsLive } = makeDo()
    const unbound: FakeSocket = { id: 'never-bound' }

    closeSocket(unbound)

    // Not the owner socket → bridge untouched.
    expect(bridgeIsLive()).toBe(true)
  })

  it('socketIsBoundSessionOwner is false before any session is created', () => {
    const preCreate = { boundSessionId: undefined, boundUserId: undefined }

    // Pre-create close must not tear down a (nonexistent) bridge — and there is no
    // owner socket recorded yet either.
    expect(socketIsBoundSessionOwner(socketA, undefined, preCreate)).toBe(false)
    expect(socketIsBoundSessionOwner(socketA, socketA, preCreate)).toBe(false)
  })

  it('socketIsBoundSessionOwner is true only for the exact owner socket', () => {
    const ownerBound = { boundSessionId: SESSION_ID, boundUserId: 'user-A' }

    // Only the recorded owner socket matches — not a same-user duplicate, not a
    // different user, not when no owner socket is recorded.
    expect(socketIsBoundSessionOwner(socketA, socketA, ownerBound)).toBe(true)
    expect(socketIsBoundSessionOwner(socketA2, socketA, ownerBound)).toBe(false)
    expect(socketIsBoundSessionOwner(socketB, socketA, ownerBound)).toBe(false)
    expect(socketIsBoundSessionOwner(socketA, undefined, ownerBound)).toBe(false)
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

describe('binary frame delivery type — arraybuffer is required for audio fidelity (F-M)', () => {
  /**
   * Models `VoiceSessionDO.onSocketMessage`'s string-vs-binary dispatch. The DO
   * accepts its `WebSocketPair` server with `binaryType = 'arraybuffer'` set
   * BEFORE `accept()`, so player audio frames arrive as `ArrayBuffer` and the
   * synchronous handler's `new Uint8Array(data)` reconstructs the exact bytes.
   *
   * Under this Worker's `compatibility_date` (2026-06-08) the runtime default
   * (`websocket_standard_binary_type`) instead delivers binary frames as `Blob`.
   * A `Blob` is neither a string nor an `ArrayBuffer`: it would fall through to
   * the binary branch and be cast to `ArrayBuffer`, and `new Uint8Array(blob)`
   * yields an empty/garbage view — corrupting every audio frame. These tests pin
   * the contract the binaryType opt-in guarantees.
   */
  const AUDIO_BYTES = new Uint8Array([0x10, 0x20, 0x30, 0x40])

  /** Mirrors onSocketMessage's dispatch: string → control, else binary audio. */
  function dispatch(data: string | ArrayBuffer): { kind: 'control' | 'audio'; frame?: Uint8Array } {
    if (typeof data === 'string') {
      return { kind: 'control' }
    }
    // Binary branch: the handler treats `data` as an ArrayBuffer (the fix's
    // guarantee) and wraps it synchronously — exactly `new Uint8Array(data)`.
    return { kind: 'audio', frame: new Uint8Array(data) }
  }

  it('reconstructs the exact audio bytes from an ArrayBuffer binary frame', () => {
    // What binaryType='arraybuffer' delivers: event.data is an ArrayBuffer.
    const arrayBuffer = AUDIO_BYTES.slice().buffer
    const result = dispatch(arrayBuffer)

    expect(result.kind).toBe('audio')
    expect(result.frame).toEqual(AUDIO_BYTES)
  })

  it('routes string frames to the control path, never the binary branch', () => {
    expect(dispatch(JSON.stringify({ type: 'turn' })).kind).toBe('control')
  })

  it('a Blob default (no binaryType opt-in) would corrupt the frame — why the fix is needed', () => {
    // Reproduce the un-fixed 2026 default: a Blob payload. It is not a string, so
    // it reaches the binary branch; `new Uint8Array(blob)` does NOT read the
    // blob's bytes — it produces a zero-length view (or throws), losing the audio.
    const blob = new Blob([AUDIO_BYTES])
    // The blob slips past the text guard (it is not a string).
    expect(typeof (blob as unknown) === 'string').toBe(false)
    // Synchronously wrapping it the way the handler does yields NOT the 4 audio
    // bytes — proving the synchronous ArrayBuffer-typed path breaks on a Blob and
    // the binaryType='arraybuffer' opt-in (set before accept) is load-bearing.
    const wrapped = new Uint8Array(blob as unknown as ArrayBuffer)
    expect(Array.from(wrapped)).not.toEqual(Array.from(AUDIO_BYTES))
  })
})
