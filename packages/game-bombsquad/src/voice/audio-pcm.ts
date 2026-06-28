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
