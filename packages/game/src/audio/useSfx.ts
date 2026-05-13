/**
 * `playSfx(type)` — fire-and-forget one-shot sound effect.
 *
 * Pulls preset (base sample + rate) from SFX_PRESETS, asks the buffer cache
 * for the decoded sample (decoding lazily on first call), and dispatches a
 * fresh AudioBufferSourceNode. Each call is independent — rapid retriggers
 * are natural since AudioBufferSourceNode is one-shot.
 *
 * Silent-fail by design: if the browser has no Web Audio, the buffer isn't
 * decoded yet, or anything else fails, the call is a no-op. Audio is
 * decorative, never load-bearing.
 *
 * Exported as a plain function (not a React hook) because there is no
 * per-component state — the AudioContext and buffer cache live at module
 * scope. The `use` prefix is preserved for naming consistency with the
 * design doc.
 */

import { getAudioContext, getBuffer } from './audio-context'
import { SFX_PRESETS, type SfxType } from './presets'

export function playSfx(type: SfxType): void {
  const preset = SFX_PRESETS[type]
  if (!preset) return
  const ctx = getAudioContext()
  if (!ctx) return

  void getBuffer(preset.sample).then((buf) => {
    if (!buf) return
    try {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = preset.rate
      // GainNode in the chain so each preset's perceived loudness can be
      // tuned independently — stopwatch tick sits below click feedback so
      // the player hears actions clearly over the ambient timer.
      const gain = ctx.createGain()
      gain.gain.value = preset.gain
      src.connect(gain)
      gain.connect(ctx.destination)
      src.start(0)
    } catch {
      // Source node creation can throw if ctx was closed; safe to ignore.
    }
  })
}
