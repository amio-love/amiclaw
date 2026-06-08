import { describe, expect, it } from 'vitest'
import { generateToken, generateSessionId, hashToken } from './crypto'

describe('auth crypto', () => {
  it('generates unique high-entropy tokens', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    // 32 bytes → 64 hex chars
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique session ids', () => {
    expect(generateSessionId()).not.toBe(generateSessionId())
  })

  it('hashToken is deterministic SHA-256 hex and never returns the plaintext (invariant ②)', async () => {
    const token = generateToken()
    const h1 = await hashToken(token)
    const h2 = await hashToken(token)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toBe(token)
  })

  it('matches a known SHA-256 vector', async () => {
    // SHA-256("abc")
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
