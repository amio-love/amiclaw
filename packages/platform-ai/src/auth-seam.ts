/**
 * Handshake-time session authentication seam (L2 §Mechanism Variant 3).
 *
 * The Platform AI Worker mounts a same-origin WS route (`claw.amio.fans/ai-ws/*`)
 * so the auth-session cookie rides along on the upgrade request. Before the
 * upgrade is accepted, the Worker must validate that cookie and resolve a
 * `userId`; an invalid/absent session is rejected at the handshake (401, no
 * upgrade).
 *
 * This module is the seam for that check, kept pure and dependency-light so it
 * is unit-testable without a live KV / network:
 *
 *  - `SessionReader` is the one-method contract: cookie header in, resolved
 *    identity out (or `null` when there is no valid session).
 *  - `createDevAuthBypassReader` is the dev-only stub: when `DEV_AUTH_BYPASS`
 *    is on it returns a fixed development identity for demo / local runs,
 *    standing in for the real `AUTH` KV lookup.
 *  - `createKvSessionReader` is the real reader: it reads `session:<id>` from
 *    the bound `AUTH` KV and resolves the identity. The cookie name and the
 *    `session:<id>` key + value schema are auth-session's real contract
 *    (`shared/auth-types.ts` `SESSION_COOKIE_NAME`,
 *    `packages/api/src/auth/{kv-keys,session}.ts`); this reader consumes a
 *    minimal structural view of that real record and never writes.
 *  - `resolveSessionReader` is the compile/run-time gate that picks the dev
 *    stub vs. the real reader from env, so the prod path never carries the stub.
 *
 * The mounting contract ("validate at handshake, reject if invalid, bind
 * userId") is fixed regardless of which reader is active.
 */

// The cookie name and the stored-record shape are the real auth-session
// contract (`implement-magic-link-auth`, merged to main). Reuse the shared
// cookie constant verbatim, and mirror the stored record shape from
// `packages/api/src/auth/session.ts` (`SessionRecord`) — see `StoredSession`.
import { SESSION_COOKIE_NAME } from '../../../shared/auth-types'

/** Resolved, already-authenticated identity for a WS session. */
export interface AuthIdentity {
  userId: string
}

/**
 * Handshake-time session validator. Given the raw `Cookie` request header,
 * resolve the authenticated identity, or `null` when there is no valid session.
 * Pure with respect to its inputs aside from the (async) KV read in the real
 * implementation; the dev stub is fully synchronous in spirit.
 */
export interface SessionReader {
  resolve(cookieHeader: string | null): Promise<AuthIdentity | null>
}

/** Fixed identity returned by the dev bypass stub. */
export const DEV_AUTH_USER_ID = 'dev-user'

/**
 * Best-effort percent-decode of a cookie value. The `Cookie` header is
 * attacker-controlled, and `decodeURIComponent` throws a `URIError` on a
 * malformed escape (a lone `%`, a half-finished `%E`, an illegal byte). At the
 * WS handshake an uncaught throw here would surface as a Worker error (500)
 * instead of the intended "no valid session" outcome — turning a bad cookie into
 * a crash rather than a clean 401. We catch the decode failure and keep the raw
 * value: a malformed cookie then simply fails to resolve to a real session id,
 * which the reader rejects (fail-closed). Pure and total — never throws.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Parse a `Cookie` request header into a name->value map. Pure and total:
 * a `null`/empty header yields an empty map; malformed pairs are skipped; a
 * value with a malformed percent-escape is kept raw rather than throwing (the
 * header is attacker-controlled — see `decodeCookieValue`).
 *
 * Duplicate cookie names resolve to the FIRST occurrence, matching the real
 * auth reader (`packages/api/src/auth/session.ts` `readCookie`, which iterates
 * `Cookie.split(';')` and returns on the first name match). A browser can send
 * the same `amiclaw_session` name more than once (a host-only cookie alongside
 * a domain/path variant); the real reader binds the first, so this seam must
 * too — otherwise `/ai-ws/*` would bind a different session id (last value)
 * than the rest of the app, mis-binding or 401-ing an already-signed-in user.
 * Split-and-trim semantics (name + value `.trim()`, case-sensitive exact name
 * match, single `Cookie` header) also mirror that reader; only the duplicate
 * resolution differs from a naive last-wins map, so it is pinned here.
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === '') continue
    // First-match wins: a later duplicate of the same name is ignored, aligning
    // `readSessionId` with the real reader's first-match. (A naive `out[name] =`
    // would keep the LAST value and diverge.)
    if (Object.prototype.hasOwnProperty.call(out, name)) continue
    const value = part.slice(eq + 1).trim()
    out[name] = decodeCookieValue(value)
  }
  return out
}

/** Extract the auth-session id from a `Cookie` header, or `null` if absent. */
export function readSessionId(cookieHeader: string | null): string | null {
  const cookies = parseCookies(cookieHeader)
  const id = cookies[SESSION_COOKIE_NAME]
  return id && id.length > 0 ? id : null
}

/**
 * Dev-only stub reader. When `DEV_AUTH_BYPASS` is on, returns a fixed
 * development identity for any request — standing in for the real `AUTH` KV
 * lookup. The prod build gates this branch out via `resolveSessionReader`, so
 * the stub never reaches a production handshake.
 */
export function createDevAuthBypassReader(): SessionReader {
  return {
    async resolve(): Promise<AuthIdentity | null> {
      return { userId: DEV_AUTH_USER_ID }
    },
  }
}

/**
 * Minimal structural view of a bound KV namespace — just the read we need.
 * Narrower than the full `KVNamespace` lib type so the reader stays testable
 * with a plain object mock.
 */
export interface SessionKvReader {
  get(key: string, type: 'json'): Promise<unknown>
}

/**
 * Minimal structural view of a stored `session:<id>` record.
 *
 * Shape authority: `packages/api/src/auth/session.ts` `SessionRecord`
 * (`{ user_id, email, created_at }`, snake_case) — this view MUST stay aligned
 * with it. The reader only needs `user_id` to resolve identity; `email` /
 * `created_at` are present in the real record but unused here. Unknown extra
 * fields are ignored.
 *
 * Validity, per the real contract: a session is valid iff its record is present
 * in KV. Revocation is a KV delete (logout) and expiry is the KV `expirationTtl`
 * — both surface as an absent record, so there is no in-record `revoked` /
 * `expiresAt` field to inspect. Presence of the record is the single check.
 */
interface StoredSession {
  user_id?: string
}

/**
 * Real session-reader plug-in seam: cookie -> session id -> `AUTH` KV `session:<id>`
 * -> identity. Read-only. Returns `null` for a missing cookie or a missing
 * record (a deleted/expired session is an absent record — see `StoredSession`).
 *
 * The `session:<id>` key shape and value schema are the auth-session contract
 * (`packages/api/src/auth/kv-keys.ts` `sessionKey`, `session.ts` `SessionRecord`);
 * this reader consumes that real shape directly.
 */
export function createKvSessionReader(kv: SessionKvReader): SessionReader {
  return {
    async resolve(cookieHeader: string | null): Promise<AuthIdentity | null> {
      const sessionId = readSessionId(cookieHeader)
      if (sessionId === null) return null

      const record = (await kv.get(`session:${sessionId}`, 'json')) as StoredSession | null
      if (record === null || typeof record.user_id !== 'string' || record.user_id === '') {
        return null
      }

      return { userId: record.user_id }
    },
  }
}

/**
 * Per-operation ownership check (L2 §Mechanism Variant 3, step 3): every
 * post-create operation must target the bound session and bound user. Throws a
 * precise error on any mismatch so an out-of-order or cross-user call is
 * rejected loudly. Pure — extracted from the DO so it is unit-testable without
 * the Workers runtime.
 *
 * @param bound        identity bound at `createSession` (`undefined` if not yet created)
 * @param boundSession this DO's session id (`undefined` if not yet created)
 * @param sessionId    session id the caller is operating on
 * @param userId       user id the caller claims
 */
export function assertSessionOwnership(
  bound: { boundSessionId: string | undefined; boundUserId: string | undefined },
  sessionId: string,
  userId: string
): void {
  if (bound.boundUserId === undefined || bound.boundSessionId === undefined) {
    throw new Error('auth-seam: operation before createSession')
  }
  if (sessionId !== bound.boundSessionId) {
    throw new Error('auth-seam: sessionId does not match this session')
  }
  if (userId !== bound.boundUserId) {
    throw new Error('auth-seam: userId does not own this session')
  }
}

/**
 * Resolve the operating user from THIS socket's bound identity and assert it owns
 * the DO's bound session — the single ownership predicate shared by every inbound
 * path (control messages AND binary audio frames). Returns the verified operating
 * user id on success; throws (fail-loud) on any reject path.
 *
 * Reject paths:
 *  - the socket carries no bound identity (never authenticated / never bound) →
 *    `socket has no authenticated identity`;
 *  - the DO has no session yet (`boundUserId`/`boundSessionId` undefined) →
 *    `operation before createSession` (from `assertSessionOwnership`);
 *  - the socket's user is not the session owner → `userId does not own this
 *    session` (from `assertSessionOwnership`).
 *
 * The binary audio path MUST funnel through this before touching the shared audio
 * bridge: without it, a second authenticated socket on the same DO (which only
 * needs to know the session name) could push frames the owner's next `turn`
 * transcribes — injecting/forging the owner's utterance and bypassing the
 * per-socket ownership invariant the control path already enforces. Pure and
 * generic over the socket type, so it is unit-testable in Node without the
 * Workers `WebSocket` runtime.
 */
export function assertSocketOwnsBoundSession<Socket>(
  registry: SocketIdentityRegistry<Socket>,
  socket: Socket,
  bound: { boundSessionId: string | undefined; boundUserId: string | undefined }
): string {
  const socketUserId = registry.resolve(socket)
  if (socketUserId === undefined) {
    throw new Error('auth-seam: socket has no authenticated identity')
  }
  // `boundSessionId` is the operating session id: a socket connected to this DO
  // operates on this DO's session, so the session axis is satisfied by identity
  // while the user axis enforces "this socket's user owns the bound session".
  assertSessionOwnership(bound, bound.boundSessionId as string, socketUserId)
  return socketUserId
}

/**
 * Total (no-throw) predicate for the socket-close handler: is the closing socket
 * the EXACT socket that created/bound the session?
 *
 * Returns `true` only when (a) a session is currently bound (`boundUserId`/
 * `boundSessionId` defined) and (b) `socket` is reference-equal to
 * `ownerSocket` — the WebSocket recorded at `createSession`. `false` for every
 * other case: no session yet, no owner socket recorded, or a different socket
 * (even one whose user id matches the bound owner).
 *
 * Why socket identity, NOT user id: the same already-authenticated user can open
 * a SECOND socket to the same `/ai-ws/{sessionName}` DO (a duplicate tab or a
 * reconnect). A user-id match would mark that second socket as an owner, so when
 * IT closes the handler would `clearSession()` and tear down the STILL-ACTIVE
 * original session / in-flight turn. Binding teardown to the creator socket's
 * reference means only the socket that actually owns the session can end it; a
 * same-user duplicate socket's close releases just its own identity binding.
 *
 * The registry param is unused for the owner check (kept for call-site symmetry
 * with `assertSocketOwnsBoundSession` and to leave room for a future
 * identity-aware variant); ownership here is purely the recorded-socket identity
 * plus the bound-session guard.
 */
export function socketIsBoundSessionOwner<Socket>(
  socket: Socket,
  ownerSocket: Socket | undefined,
  bound: { boundSessionId: string | undefined; boundUserId: string | undefined }
): boolean {
  if (bound.boundUserId === undefined || bound.boundSessionId === undefined) return false
  if (ownerSocket === undefined) return false
  return socket === ownerSocket
}

/**
 * Per-socket authenticated identity (L2 §Mechanism Variant 3, step 3).
 *
 * The forwarded `X-Session-User-Id` is the identity of ONE accepted socket, not
 * a property of the DO instance. Two already-authenticated clients connecting to
 * the same-named DO share one instance, so storing the forwarded id in a single
 * instance field lets the later upgrade overwrite the earlier one — after which
 * a `create`/`turn`/`end` from socket A would run under socket B's user. Binding
 * the id to the specific accepted socket and resolving it per message removes
 * that cross-socket contamination.
 *
 * `WebSocket` identity (reference equality) is the map key, so this works
 * regardless of how the socket is accepted (hibernation or plain `accept()`):
 * each accepted socket maps to its own forwarded user id, and a control message
 * resolves the id of the exact socket it arrived on.
 *
 * Kept generic over the socket type (`Socket`) so it is unit-testable in Node
 * without the Workers `WebSocket` runtime — the DO instantiates it with the real
 * `WebSocket` type.
 */
export class SocketIdentityRegistry<Socket> {
  private readonly bySocket = new Map<Socket, string>()

  /** Bind the authenticated user id to a freshly accepted socket. */
  bind(socket: Socket, userId: string): void {
    this.bySocket.set(socket, userId)
  }

  /**
   * The user id bound to THIS socket, or `undefined` if the socket was never
   * bound (e.g. a control message before the upgrade bound an identity).
   */
  resolve(socket: Socket): string | undefined {
    return this.bySocket.get(socket)
  }

  /** Drop a socket's binding when it closes, so the map does not leak entries. */
  release(socket: Socket): void {
    this.bySocket.delete(socket)
  }

  /** Number of currently bound sockets — test/inspection aid. */
  get size(): number {
    return this.bySocket.size
  }
}

/** Env shape the seam reads to decide which reader to construct. */
export interface AuthSeamEnv {
  DEV_AUTH_BYPASS?: string
  AUTH?: SessionKvReader
}

/** True when the `DEV_AUTH_BYPASS` env var is set to an on-ish value. */
export function isDevAuthBypassEnabled(env: AuthSeamEnv): boolean {
  const flag = env.DEV_AUTH_BYPASS
  return flag === 'true' || flag === '1'
}

/**
 * Pick the active reader from env. Dev bypass wins when enabled; otherwise the
 * real `AUTH` KV reader is required. Throwing on a missing `AUTH` binding (when
 * not in dev bypass) makes a mis-wired prod deploy fail loudly at the first
 * handshake rather than silently letting everyone in.
 */
export function resolveSessionReader(env: AuthSeamEnv): SessionReader {
  if (isDevAuthBypassEnabled(env)) {
    return createDevAuthBypassReader()
  }
  if (!env.AUTH) {
    throw new Error(
      'auth-seam: AUTH KV namespace is not bound and DEV_AUTH_BYPASS is off — cannot validate sessions'
    )
  }
  return createKvSessionReader(env.AUTH)
}
