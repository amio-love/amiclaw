import { describe, it, expect } from 'vitest'
import { base64ToBytes, floatTo16BitPCM, pcm16ToFloat32 } from './audio-pcm'

describe('floatTo16BitPCM', () => {
  it('produces 2 little-endian bytes per sample', () => {
    const buf = floatTo16BitPCM(new Float32Array([0, 0, 0]))
    expect(buf.byteLength).toBe(6)
  })

  it('maps the full-scale endpoints to the asymmetric Int16 range', () => {
    const view = new DataView(floatTo16BitPCM(new Float32Array([0, 1, -1])))
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(0x7fff) // +1.0 -> 32767
    expect(view.getInt16(4, true)).toBe(-0x8000) // -1.0 -> -32768
  })

  it('clamps out-of-range samples to [-1, 1]', () => {
    const view = new DataView(floatTo16BitPCM(new Float32Array([2, -2])))
    expect(view.getInt16(0, true)).toBe(0x7fff)
    expect(view.getInt16(2, true)).toBe(-0x8000)
  })
})

describe('pcm16ToFloat32', () => {
  it('decodes Int16 LE bytes back to Float32 samples', () => {
    const pcm = floatTo16BitPCM(new Float32Array([0, 1, -1]))
    const floats = pcm16ToFloat32(new Uint8Array(pcm))
    expect(floats.length).toBe(3)
    expect(floats[0]).toBeCloseTo(0, 5)
    expect(floats[1]).toBeCloseTo(1, 4)
    expect(floats[2]).toBeCloseTo(-1, 4)
  })

  it('ignores a trailing odd byte (incomplete Int16)', () => {
    expect(pcm16ToFloat32(new Uint8Array([0x00, 0x40, 0xff])).length).toBe(1)
  })

  it('reads through a subarray view without grabbing the whole buffer', () => {
    const backing = new Uint8Array([0xff, 0xff, 0x00, 0x40, 0x00, 0x00])
    const view = backing.subarray(2, 4) // the +0.5-ish sample only
    const floats = pcm16ToFloat32(view)
    expect(floats.length).toBe(1)
    expect(floats[0]).toBeCloseTo(0x4000 / 0x7fff, 4)
  })

  it('round-trips arbitrary samples within one quantization step', () => {
    const samples = new Float32Array([0.5, -0.5, 0.25, -0.75, 0.123, -0.987])
    const decoded = pcm16ToFloat32(new Uint8Array(floatTo16BitPCM(samples)))
    for (let i = 0; i < samples.length; i += 1) {
      expect(decoded[i]).toBeCloseTo(samples[i], 3)
    }
  })
})

describe('base64ToBytes', () => {
  it('decodes base64 to the original bytes', () => {
    const original = new Uint8Array([0, 1, 2, 250, 255])
    const b64 = btoa(String.fromCharCode(...original))
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(original))
  })

  it('decodes an empty string to an empty array', () => {
    expect(base64ToBytes('').length).toBe(0)
  })

  it('round-trips a PCM frame through base64 (server transport shape)', () => {
    const pcm = new Uint8Array(floatTo16BitPCM(new Float32Array([0.5, -0.5])))
    const b64 = btoa(String.fromCharCode(...pcm))
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(pcm))
  })
})
