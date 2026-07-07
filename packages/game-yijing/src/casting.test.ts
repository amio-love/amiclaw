import { describe, expect, it } from 'vitest'
import { castThrow } from './casting'

/* Three-coin casting — exact distribution over the full byte domain.
 *
 * castThrow consumes one uniform byte and reads its low 3 bits as three fair
 * coins, so enumerating all 256 byte values yields the EXACT canonical odds:
 *   6 老阴 1/8 · 7 少阳 3/8 · 8 少阴 3/8 · 9 老阳 1/8
 * (each 3-bit pattern occurs 32 times in 0..255). */

describe('castThrow', () => {
  it('maps the coin triples to yao values with canonical probabilities', () => {
    const counts: Record<number, number> = { 6: 0, 7: 0, 8: 0, 9: 0 }
    for (let byte = 0; byte < 256; byte++) {
      const { sides, value } = castThrow(() => byte)
      expect(sides).toHaveLength(3)
      const heads = sides.filter((s) => s === 'heads').length
      // heads=字=3, tails=背=2 → value = 6 + heads.
      expect(value).toBe(6 + heads)
      counts[value] += 1
    }
    expect(counts).toEqual({ 6: 32, 7: 96, 8: 96, 9: 32 })
  })

  it('resolves the boundary bytes to 老阴 / 老阳', () => {
    expect(castThrow(() => 0b000).value).toBe(6)
    expect(castThrow(() => 0b111).value).toBe(9)
    // Only the low 3 bits participate.
    expect(castThrow(() => 0b11111000).value).toBe(6)
  })

  it('uses the platform CSPRNG by default and stays in the yao domain', () => {
    for (let i = 0; i < 32; i++) {
      const { value } = castThrow()
      expect([6, 7, 8, 9]).toContain(value)
    }
  })
})
