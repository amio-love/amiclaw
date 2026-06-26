// Pure audio-format helpers for the voice-session demo.
//
// Side-effect-free ESM: no DOM / Web Audio access at module top level, so it is
// safe to import from both the browser demo client (`demo.js`) and the vitest
// unit test (`audio-pcm.test.js`).

/**
 * Convert mono Float32 PCM samples (range [-1, 1]) to 16-bit little-endian PCM.
 *
 * Each sample is clamped to [-1, 1], scaled to the signed 16-bit range
 * (negative side uses 0x8000, positive side uses 0x7FFF), rounded to an integer,
 * and written little-endian. The result is `samples.length * 2` bytes — the
 * exact wire format the real STT adapter expects (`format:'pcm', bits:16`).
 *
 * @param {Float32Array} samples Mono Float32 samples in [-1, 1].
 * @returns {ArrayBuffer} Int16 little-endian PCM, 2 bytes per sample.
 */
export function floatTo16BitPCM(samples) {
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
