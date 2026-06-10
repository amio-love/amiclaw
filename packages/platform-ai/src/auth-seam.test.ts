import { describe, expect, it } from 'vitest'
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

// --- cookie parsing (pure) ----------------------------------------------

describe('parseCookies / readSessionId', () => {
  it('parses a cookie header into a name->value map', () => {
    expect(parseCookies('a=1; session=abc; b=2')).toEqual({ a: '1', session: 'abc', b: '2' })
  })

  it('returns an empty map for a null/empty header', () => {
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('extracts the session id, or null when absent', () => {
    expect(readSessionId('session=xyz')).toBe('xyz')
    expect(readSessionId('other=1')).toBeNull()
    expect(readSessionId(null)).toBeNull()
  })

  it('percent-decodes a well-formed cookie value', () => {
    expect(parseCookies('session=a%20b')).toEqual({ session: 'a b' })
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
    expect(() => parseCookies('session=%')).not.toThrow()
    expect(parseCookies('session=%')).toEqual({ session: '%' })
  })

  it('keeps a truncated escape raw instead of throwing', () => {
    expect(() => parseCookies('session=%E')).not.toThrow()
    expect(parseCookies('session=%E')).toEqual({ session: '%E' })
  })

  it('keeps an illegal-byte escape raw instead of throwing', () => {
    // %ZZ is not a valid hex escape; %C3%28 is an invalid UTF-8 sequence.
    expect(() => parseCookies('session=%ZZ')).not.toThrow()
    expect(parseCookies('session=%ZZ')).toEqual({ session: '%ZZ' })
    expect(() => parseCookies('session=%C3%28')).not.toThrow()
    expect(parseCookies('session=%C3%28')).toEqual({ session: '%C3%28' })
  })

  it('isolates a malformed value to its own pair, keeping siblings decoded', () => {
    // A bad `session` value must not poison a well-formed sibling cookie.
    expect(() => parseCookies('a=ok; session=%; b=%41')).not.toThrow()
    expect(parseCookies('a=ok; session=%; b=%41')).toEqual({ a: 'ok', session: '%', b: 'A' })
  })

  it('readSessionId stays total on a malformed session cookie', () => {
    // The malformed value survives as a raw string; it does not match a real
    // session record downstream, so the KV reader rejects it (fail-closed).
    expect(() => readSessionId('session=%')).not.toThrow()
    expect(readSessionId('session=%')).toBe('%')
  })
})

describe('createKvSessionReader — malformed cookie fails closed, never throws (F-D)', () => {
  it('returns null (unauthorized) for a malformed session cookie', async () => {
    const reader = createKvSessionReader(mockKv({ 'session:s1': { userId: 'u1' } }))
    // `session:%` is not a stored key → no record → null, not a thrown error.
    await expect(reader.resolve('session=%')).resolves.toBeNull()
    await expect(reader.resolve('session=%E')).resolves.toBeNull()
    await expect(reader.resolve('session=%C3%28')).resolves.toBeNull()
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
    expect(await reader.resolve('session=anything')).toEqual({ userId: DEV_AUTH_USER_ID })
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

describe('createKvSessionReader', () => {
  it('resolves a valid session record to its userId', async () => {
    const reader = createKvSessionReader(mockKv({ 'session:s1': { userId: 'u1' } }))
    expect(await reader.resolve('session=s1')).toEqual({ userId: 'u1' })
  })

  it('rejects a missing cookie', async () => {
    const reader = createKvSessionReader(mockKv({ 'session:s1': { userId: 'u1' } }))
    expect(await reader.resolve(null)).toBeNull()
    expect(await reader.resolve('other=1')).toBeNull()
  })

  it('rejects a session id with no stored record', async () => {
    const reader = createKvSessionReader(mockKv({}))
    expect(await reader.resolve('session=ghost')).toBeNull()
  })

  it('rejects a revoked record', async () => {
    const reader = createKvSessionReader(mockKv({ 'session:s1': { userId: 'u1', revoked: true } }))
    expect(await reader.resolve('session=s1')).toBeNull()
  })

  it('rejects an expired record (injectable clock)', async () => {
    const reader = createKvSessionReader(
      mockKv({ 'session:s1': { userId: 'u1', expiresAt: 1000 } }),
      () => 2000
    )
    expect(await reader.resolve('session=s1')).toBeNull()
  })

  it('accepts a not-yet-expired record', async () => {
    const reader = createKvSessionReader(
      mockKv({ 'session:s1': { userId: 'u1', expiresAt: 5000 } }),
      () => 2000
    )
    expect(await reader.resolve('session=s1')).toEqual({ userId: 'u1' })
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
      AUTH: mockKv({ 'session:s1': { userId: 'u1' } }),
    })
    expect(await reader.resolve('session=s1')).toEqual({ userId: 'u1' })
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
