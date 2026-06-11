import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE_NAME } from '../../../shared/auth-types'
import {
  assertSessionOwnership,
  createDevAuthBypassReader,
  createKvSessionReader,
  DEV_AUTH_USER_ID,
  isDevAuthBypassEnabled,
  parseCookies,
  readSessionId,
  resolveSessionReader,
  type SessionKvReader,
} from './auth-seam'

// The real auth-session cookie name (`amiclaw_session`), reused from the shared
// contract so these tests track the same constant the seam imports rather than a
// hard-coded literal — if the shared name changes, the tests follow.
const COOKIE = SESSION_COOKIE_NAME

// --- cookie parsing (pure) ----------------------------------------------

describe('parseCookies / readSessionId', () => {
  it('parses a cookie header into a name->value map', () => {
    expect(parseCookies(`a=1; ${COOKIE}=abc; b=2`)).toEqual({ a: '1', [COOKIE]: 'abc', b: '2' })
  })

  it('returns an empty map for a null/empty header', () => {
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('extracts the session id, or null when absent', () => {
    expect(readSessionId(`${COOKIE}=xyz`)).toBe('xyz')
    expect(readSessionId('other=1')).toBeNull()
    expect(readSessionId(null)).toBeNull()
  })

  it('reads the real auth cookie name, not a bare `session`', () => {
    // Guards F-T: a record exists under the legacy `session` cookie name but the
    // reader must key off the real `amiclaw_session` name. The bare-`session`
    // cookie carries no session id as far as the seam is concerned.
    expect(COOKIE).toBe('amiclaw_session')
    expect(readSessionId('session=xyz')).toBeNull()
  })

  it('percent-decodes a well-formed cookie value', () => {
    expect(parseCookies(`${COOKIE}=a%20b`)).toEqual({ [COOKIE]: 'a b' })
  })
})

// --- malformed-cookie robustness (F-D) ----------------------------------
//
// The `Cookie` header is attacker-controlled. A malformed percent-escape makes
// `decodeURIComponent` throw a `URIError`; at the WS handshake an uncaught throw
// would surface as a Worker error (500) instead of the intended "no valid
// session" → 401. `parseCookies` must be total: keep the raw value, never throw,
// so a bad cookie fails closed (resolves to no/garbage session id, which the
// reader rejects).

describe('parseCookies — malformed percent-escapes do not throw (F-D)', () => {
  it('keeps a lone-percent value raw instead of throwing', () => {
    expect(() => parseCookies(`${COOKIE}=%`)).not.toThrow()
    expect(parseCookies(`${COOKIE}=%`)).toEqual({ [COOKIE]: '%' })
  })

  it('keeps a truncated escape raw instead of throwing', () => {
    expect(() => parseCookies(`${COOKIE}=%E`)).not.toThrow()
    expect(parseCookies(`${COOKIE}=%E`)).toEqual({ [COOKIE]: '%E' })
  })

  it('keeps an illegal-byte escape raw instead of throwing', () => {
    // %ZZ is not a valid hex escape; %C3%28 is an invalid UTF-8 sequence.
    expect(() => parseCookies(`${COOKIE}=%ZZ`)).not.toThrow()
    expect(parseCookies(`${COOKIE}=%ZZ`)).toEqual({ [COOKIE]: '%ZZ' })
    expect(() => parseCookies(`${COOKIE}=%C3%28`)).not.toThrow()
    expect(parseCookies(`${COOKIE}=%C3%28`)).toEqual({ [COOKIE]: '%C3%28' })
  })

  it('isolates a malformed value to its own pair, keeping siblings decoded', () => {
    // A bad session value must not poison a well-formed sibling cookie.
    expect(() => parseCookies(`a=ok; ${COOKIE}=%; b=%41`)).not.toThrow()
    expect(parseCookies(`a=ok; ${COOKIE}=%; b=%41`)).toEqual({ a: 'ok', [COOKIE]: '%', b: 'A' })
  })

  it('readSessionId stays total on a malformed session cookie', () => {
    // The malformed value survives as a raw string; it does not match a real
    // session record downstream, so the KV reader rejects it (fail-closed).
    expect(() => readSessionId(`${COOKIE}=%`)).not.toThrow()
    expect(readSessionId(`${COOKIE}=%`)).toBe('%')
  })
})

describe('createKvSessionReader — malformed cookie fails closed, never throws (F-D)', () => {
  it('returns null (unauthorized) for a malformed session cookie', async () => {
    const reader = createKvSessionReader(mockKv({ 'session:s1': realRecord('u1') }))
    // `session:%` is not a stored key → no record → null, not a thrown error.
    await expect(reader.resolve(`${COOKIE}=%`)).resolves.toBeNull()
    await expect(reader.resolve(`${COOKIE}=%E`)).resolves.toBeNull()
    await expect(reader.resolve(`${COOKIE}=%C3%28`)).resolves.toBeNull()
  })
})

// --- dev bypass stub -----------------------------------------------------

describe('dev auth bypass', () => {
  it('isDevAuthBypassEnabled reads on-ish values', () => {
    expect(isDevAuthBypassEnabled({ DEV_AUTH_BYPASS: 'true' })).toBe(true)
    expect(isDevAuthBypassEnabled({ DEV_AUTH_BYPASS: '1' })).toBe(true)
    expect(isDevAuthBypassEnabled({ DEV_AUTH_BYPASS: 'false' })).toBe(false)
    expect(isDevAuthBypassEnabled({})).toBe(false)
  })

  it('dev stub returns a fixed identity for any request', async () => {
    const reader = createDevAuthBypassReader()
    expect(await reader.resolve(null)).toEqual({ userId: DEV_AUTH_USER_ID })
    expect(await reader.resolve(`${COOKIE}=anything`)).toEqual({ userId: DEV_AUTH_USER_ID })
  })
})

// --- real KV reader ------------------------------------------------------

function mockKv(records: Record<string, unknown>): SessionKvReader {
  return {
    async get(key: string): Promise<unknown> {
      return key in records ? records[key] : null
    },
  }
}

/**
 * The real stored record shape written by auth-session
 * (`packages/api/src/auth/session.ts` `SessionRecord`): snake_case `user_id`
 * plus `email` / `created_at`. The reader resolves identity off `user_id`.
 */
function realRecord(userId: string): { user_id: string; email: string; created_at: string } {
  return { user_id: userId, email: `${userId}@example.com`, created_at: '2026-01-01T00:00:00.000Z' }
}

describe('createKvSessionReader', () => {
  it('resolves a real auth-session record (snake_case user_id) to its userId', async () => {
    // F-U: the real `session:<id>` record is `{ user_id, email, created_at }`.
    // The reader keys off `user_id` and surfaces the seam's `{ userId }` identity.
    const reader = createKvSessionReader(mockKv({ 'session:s1': realRecord('u1') }))
    expect(await reader.resolve(`${COOKIE}=s1`)).toEqual({ userId: 'u1' })
  })

  it('rejects a legacy camelCase-only record (F-U)', async () => {
    // A record carrying only the old camelCase `userId` (the pre-fix stub shape)
    // has no real `user_id` field → not a valid real session → 401.
    const reader = createKvSessionReader(mockKv({ 'session:s1': { userId: 'u1' } }))
    expect(await reader.resolve(`${COOKIE}=s1`)).toBeNull()
  })

  it('rejects the right id under the wrong (legacy) cookie name (F-T)', async () => {
    // The session id is stored, but presented under the bare `session` cookie
    // name instead of the real `amiclaw_session` → no session id read → 401.
    const reader = createKvSessionReader(mockKv({ 'session:s1': realRecord('u1') }))
    expect(await reader.resolve('session=s1')).toBeNull()
  })

  it('rejects a missing cookie', async () => {
    const reader = createKvSessionReader(mockKv({ 'session:s1': realRecord('u1') }))
    expect(await reader.resolve(null)).toBeNull()
    expect(await reader.resolve('other=1')).toBeNull()
  })

  it('rejects a session id with no stored record', async () => {
    // A deleted (logout/revoked) or TTL-expired session is an absent KV record;
    // the real contract has no in-record revoked/expiresAt flag.
    const reader = createKvSessionReader(mockKv({}))
    expect(await reader.resolve(`${COOKIE}=ghost`)).toBeNull()
  })
})

// --- reader resolution gate ---------------------------------------------

describe('resolveSessionReader', () => {
  it('returns the dev stub when bypass is on', async () => {
    const reader = resolveSessionReader({ DEV_AUTH_BYPASS: 'true' })
    expect(await reader.resolve(null)).toEqual({ userId: DEV_AUTH_USER_ID })
  })

  it('returns the real KV reader when bypass is off and AUTH is bound', async () => {
    const reader = resolveSessionReader({
      DEV_AUTH_BYPASS: 'false',
      AUTH: mockKv({ 'session:s1': realRecord('u1') }),
    })
    expect(await reader.resolve(`${COOKIE}=s1`)).toEqual({ userId: 'u1' })
  })

  it('throws when bypass is off and AUTH is not bound', () => {
    expect(() => resolveSessionReader({ DEV_AUTH_BYPASS: 'false' })).toThrow(/AUTH KV/)
  })
})

// --- per-operation ownership check --------------------------------------

describe('assertSessionOwnership', () => {
  const bound = { boundSessionId: 's1', boundUserId: 'u1' }

  it('passes for the bound session + bound user', () => {
    expect(() => assertSessionOwnership(bound, 's1', 'u1')).not.toThrow()
  })

  it('rejects an operation before createSession', () => {
    expect(() =>
      assertSessionOwnership({ boundSessionId: undefined, boundUserId: undefined }, 's1', 'u1')
    ).toThrow(/before createSession/)
  })

  it('rejects a mismatched sessionId (cross-session)', () => {
    expect(() => assertSessionOwnership(bound, 'other-session', 'u1')).toThrow(
      /sessionId does not match/
    )
  })

  it('rejects a mismatched userId (cross-user access)', () => {
    expect(() => assertSessionOwnership(bound, 's1', 'intruder')).toThrow(/does not own/)
  })
})
