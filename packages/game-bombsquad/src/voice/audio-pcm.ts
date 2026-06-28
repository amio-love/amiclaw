/**
 * Pure audio-format helpers for the BombSquad voice session.
 *
 * Side-effect-free: no DOM / Web Audio / WebSocket access at module top level, so
 * these are safe to import from both the React hook (`useVoiceSession.ts`) and the
 * vitest unit tests. The hook owns all Web Audio side effects; this module only
 * converts byte/sample representations.
 *
 * Two directions are needed by the voice session:
 *  - mic capture: Float32 samples (Web Audio) -> Int16 little-endian PCM, the exact
 *    wire format the STT adapter expects (`volcengine.ts`: format 'pcm', bits 16,
 *    rate 16000, channel 1).
 *  - TTS playback: base64 JSON-transported audio frame -> Int16 LE PCM bytes ->
 *    Float32 samples, which the hook wraps in an `AudioBuffer` for scheduled
 *    playback.
 */

/**
 * Convert mono Float32 PCM samples (range [-1, 1]) to 16-bit little-endian PCM.
 *
 * Each sample is clamped to [-1, 1], scaled to the signed 16-bit range (negative
 * side uses 0x8000, positive side uses 0x7FFF), rounded, and written
 * little-endian. The result is `samples.length * 2` bytes — the wire format the
 * STT adapter expects (`format:'pcm', bits:16`). Mirrors the demo's
 * `floatTo16BitPCM` (`demo/audio-pcm.js`) so the capture path is protocol-identical.
 */
export function floatTo16BitPCM(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < samples.length; i += 1) {
    let s = samples[i]
    if (s > 1) s = 1
    else if (s < -1) s = -1
    const int = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
    view.setInt16(i * 2, int, true)
  }
  return buffer
}

/**
 * Linear-resample mono Float32 PCM samples from `fromRate` to `toRate`.
 *
 * The mic capture wire format is fixed at PCM16 16 kHz mono, but a browser is
 * free to ignore `new AudioContext({ sampleRate: 16000 })` and hand back a
 * context at the hardware rate (commonly 48000). Sending those samples to the
 * server mislabelled as 16 kHz feeds the STT garbage and the server fails the
 * session loud with a 1008. Resampling to the true 16 kHz before
 * `floatTo16BitPCM` keeps the wire contract correct on any device.
 *
 * Linear interpolation is sufficient for speech (the directive's accepted
 * trade-off): output sample `i` lands at input position `i * fromRate / toRate`
 * and is the linear blend of its two neighbouring input samples. When the rates
 * already match (or the input is empty) the input is returned unchanged, so the
 * common 16 kHz path stays allocation-free. Downsampling applies no anti-alias
 * pre-filter — acceptable for the narrow-band speech the STT consumes.
 */
export function resamplePcmFloat32(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) {
    throw new Error('resamplePcmFloat32: sample rates must be positive')
  }
  if (fromRate === toRate || input.length === 0) return input
  const outLength = Math.max(1, Math.round((input.length * toRate) / fromRate))
  const out = new Float32Array(outLength)
  const step = fromRate / toRate
  const lastIndex = input.length - 1
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * step
    const i0 = Math.floor(pos)
    const i1 = i0 < lastIndex ? i0 + 1 : lastIndex
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/**
 * Decode a base64 string (a JSON-transported audio frame) to its raw bytes.
 * Uses the browser `atob` over a latin1 string, byte-by-byte — the inverse of the
 * server's `base64FromBytes` (`session-do.ts`). Frames are small per-sentence TTS
 * chunks, so the per-char loop stays cheap.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Convert Int16 little-endian PCM bytes to mono Float32 samples in [-1, 1) — the
 * inverse of `floatTo16BitPCM`, used to load a TTS audio frame into an
 * `AudioBuffer` for playback. Negative samples divide by 0x8000 and positive by
 * 0x7FFF, mirroring the asymmetric scale the encoder used so the round-trip is
 * tight (within one quantization step).
 *
 * A trailing odd byte (incomplete Int16) is ignored — `floor(byteLength / 2)`
 * samples are produced. Reads through a `DataView` over the exact byte range so a
 * subarray view never grabs the whole backing buffer.
 */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const out = new Float32Array(sampleCount)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < sampleCount; i += 1) {
    const int = view.getInt16(i * 2, true)
    out[i] = int < 0 ? int / 0x8000 : int / 0x7fff
  }
  return out
}
