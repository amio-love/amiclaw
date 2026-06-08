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
 *    is on it returns a fixed development identity, standing in for the real
 *    `AUTH` KV lookup until auth-session's shared session-reader lands.
 *  - `createKvSessionReader` is the real-reader plug-in seam: it reads
 *    `session:<id>` from the bound `AUTH` KV and resolves the identity. The
 *    concrete `session:<id>` value schema is owned by auth-session; this reader
 *    consumes a minimal structural view and never writes.
 *  - `resolveSessionReader` is the compile/run-time gate that picks the dev
 *    stub vs. the real reader from env, so the prod path never carries the stub.
 *
 * The mounting contract ("validate at handshake, reject if invalid, bind
 * userId") is fixed regardless of which reader is active.
 */

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

/** Cookie name carrying the auth-session id (owned by auth-session). */
const SESSION_COOKIE_NAME = 'session'

/**
 * Parse a `Cookie` request header into a name->value map. Pure and total:
 * a `null`/empty header yields an empty map; malformed pairs are skipped.
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === '') continue
    const value = part.slice(eq + 1).trim()
    out[name] = decodeURIComponent(value)
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
 * Minimal structural view of a stored `session:<id>` record. The full schema is
 * owned by auth-session; this reader consumes only what it needs to resolve an
 * identity and honour revocation. Unknown extra fields are ignored.
 */
interface StoredSession {
  userId?: string
  /** Optional epoch-ms expiry; a past value is treated as no valid session. */
  expiresAt?: number
  /** Optional revocation flag; `true` is treated as no valid session. */
  revoked?: boolean
}

/**
 * Real session-reader plug-in seam: cookie -> session id -> `AUTH` KV `session:<id>`
 * -> identity. Read-only. Returns `null` for a missing cookie, a missing
 * record, a revoked record, or an expired record. `now` is injectable so expiry
 * is testable without wall-clock coupling.
 *
 * The exact `session:<id>` value schema is auth-session's contract; once its
 * shared reader lands this wrapper is the single plug-in point to swap in.
 */
export function createKvSessionReader(
  kv: SessionKvReader,
  now: () => number = Date.now
): SessionReader {
  return {
    async resolve(cookieHeader: string | null): Promise<AuthIdentity | null> {
      const sessionId = readSessionId(cookieHeader)
      if (sessionId === null) return null

      const record = (await kv.get(`session:${sessionId}`, 'json')) as StoredSession | null
      if (record === null || typeof record.userId !== 'string' || record.userId === '') {
        return null
      }
      if (record.revoked === true) return null
      if (typeof record.expiresAt === 'number' && record.expiresAt <= now()) return null

      return { userId: record.userId }
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
