import { describe, expect, it } from 'vitest'
import { safeCloseReason } from './session-do'

/**
 * `safeCloseReason` guards the fail-loud WS close path. The WebSocket spec caps a
 * close reason at 123 UTF-8 bytes; handing `connection.close()` an over-long
 * reason throws `SyntaxError`, which — on the error path where the reason is a
 * provider error string — crashes the very close meant to fail the turn loud,
 * parking it silently. The helper must truncate by BYTES (multibyte-safe), never
 * by UTF-16 code units.
 */
const utf8 = new TextEncoder()

describe('safeCloseReason', () => {
  it('passes a short ASCII reason through untouched', () => {
    const reason = 'turn before create'
    expect(safeCloseReason(reason)).toBe(reason)
  })

  it('passes a reason of exactly 123 ASCII bytes through untouched', () => {
    const reason = 'a'.repeat(123)
    expect(utf8.encode(reason).length).toBe(123)
    expect(safeCloseReason(reason)).toBe(reason)
  })

  it('caps a long ASCII reason to <=123 bytes', () => {
    const reason = 'x'.repeat(500)
    const out = safeCloseReason(reason)
    expect(utf8.encode(out).length).toBeLessThanOrEqual(123)
    expect(out).toBe('x'.repeat(123))
  })

  it('caps a long multibyte reason to <=123 bytes without splitting a code point', () => {
    // The real failure mode: a Volcengine error string with Chinese text. Each
    // CJK char is 3 UTF-8 bytes, so 123 CHARS would be 369 BYTES — a char-based
    // slice(0, 123) would still throw. The byte budget allows at most 41 whole
    // CJK chars (41 * 3 = 123).
    const reason = '解'.repeat(200)
    const out = safeCloseReason(reason)
    const outBytes = utf8.encode(out)
    expect(outBytes.length).toBeLessThanOrEqual(123)
    // Truncation lands on a code-point boundary, so the result re-encodes/decodes
    // cleanly (no replacement char from a split multibyte sequence).
    expect(out).toBe('解'.repeat(41))
    expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(outBytes)).toBe(out)
  })

  it('does not split a multibyte sequence straddling the 123-byte boundary', () => {
    // 1 ASCII byte then 3-byte CJK chars: char index 40 occupies bytes 121/122/123,
    // so its third byte sits exactly on the 123-byte budget. A naive byte slice at
    // 123 would keep 2 of its 3 bytes (an invalid partial sequence). The helper
    // walks back off the continuation bytes and drops the whole partial char,
    // yielding 'a' + 40 whole chars = 121 valid bytes.
    const reason = `a${'语'.repeat(60)}`
    const out = safeCloseReason(reason)
    const outBytes = utf8.encode(out)
    expect(outBytes.length).toBeLessThanOrEqual(123)
    expect(out).toBe(`a${'语'.repeat(40)}`)
    expect(outBytes.length).toBe(121)
    // Re-decoding with fatal:true proves no multibyte sequence was split.
    expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(outBytes)).toBe(out)
  })
})
