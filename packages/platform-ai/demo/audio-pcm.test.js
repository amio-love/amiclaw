import { describe, expect, it } from 'vitest'
import { floatTo16BitPCM } from './audio-pcm.js'

describe('floatTo16BitPCM', () => {
  it('returns an ArrayBuffer of 2 bytes per sample', () => {
    const out = floatTo16BitPCM(new Float32Array(8))
    expect(out).toBeInstanceOf(ArrayBuffer)
    expect(out.byteLength).toBe(8 * 2)
  })

  it('returns an empty buffer for an empty input', () => {
    expect(floatTo16BitPCM(new Float32Array(0)).byteLength).toBe(0)
  })

  it('maps the boundary values exactly: 1.0 -> 0x7FFF, -1.0 -> -0x8000, 0 -> 0', () => {
    const view = new DataView(floatTo16BitPCM(new Float32Array([1, -1, 0])))
    expect(view.getInt16(0, true)).toBe(0x7fff)
    expect(view.getInt16(2, true)).toBe(-0x8000)
    expect(view.getInt16(4, true)).toBe(0)
  })

  it('clamps out-of-range samples into [-1, 1]', () => {
    const view = new DataView(floatTo16BitPCM(new Float32Array([2, -2, 1.5, -3])))
    expect(view.getInt16(0, true)).toBe(0x7fff)
    expect(view.getInt16(2, true)).toBe(-0x8000)
    expect(view.getInt16(4, true)).toBe(0x7fff)
    expect(view.getInt16(6, true)).toBe(-0x8000)
  })

  it('writes samples little-endian (low byte first)', () => {
    const bytes = new Uint8Array(floatTo16BitPCM(new Float32Array([1, -1])))
    // 0x7FFF little-endian -> [0xFF, 0x7F]
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0x7f)
    // -0x8000 (two's complement 0x8000) little-endian -> [0x00, 0x80]
    expect(bytes[2]).toBe(0x00)
    expect(bytes[3]).toBe(0x80)
  })
})
