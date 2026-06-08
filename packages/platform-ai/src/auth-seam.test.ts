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
