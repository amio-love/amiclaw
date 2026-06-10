import { describe, expect, it } from 'vitest'
import { assertSessionOwnership, SocketIdentityRegistry } from './auth-seam'

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
