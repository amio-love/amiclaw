/**
 * `playSfx(type)` — fire-and-forget one-shot sound effect.
 *
 * Two playback paths, chosen by the preset shape:
 * - **Sample presets**: pull the preset (base sample + rate) from
 *   SFX_PRESETS, ask the buffer cache for the decoded sample (decoding lazily
 *   on first call), and dispatch a fresh AudioBufferSourceNode.
 * - **Chime presets**: synthesise a short rising note sequence with
 *   oscillators on the fly — no asset to decode.
 *
 * Each call is independent — rapid retriggers are natural since both
 * AudioBufferSourceNode and OscillatorNode are one-shot.
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

import { getAudioContext, getBuffer, getMasterGain, isSfxSuppressed } from './audio-context'
import { SFX_PRESETS, type ChimePreset, type SfxType } from './presets'

/**
 * Synthesise a chime preset: each note is an oscillator with a quick attack
 * and exponential decay, scheduled in sequence off the context clock. Routed
 * through the shared master gain so mute applies, falling back to the raw
 * destination. Wrapped per-note so one failed node never aborts the rest.
 */
function playChime(preset: ChimePreset, ctx: AudioContext): void {
  const destination = getMasterGain() ?? ctx.destination
  const start = ctx.currentTime
  const attack = 0.012
  preset.notes.forEach((freq, i) => {
    try {
      const osc = ctx.createOscillator()
      osc.type = preset.waveform
      osc.frequency.value = freq
      const env = ctx.createGain()
      const noteStart = start + i * preset.noteStride
      // exponentialRamp can't target 0, so floor the envelope at a near-zero
      // value and ramp between that and the peak gain.
      env.gain.setValueAtTime(0.0001, noteStart)
      env.gain.exponentialRampToValueAtTime(preset.gain, noteStart + attack)
      env.gain.exponentialRampToValueAtTime(0.0001, noteStart + preset.noteDuration)
      osc.connect(env)
      env.connect(destination)
      osc.start(noteStart)
      osc.stop(noteStart + preset.noteDuration + 0.02)
    } catch {
      // createOscillator / connect can throw if the context was closed; ignore.
    }
  })
}

export function playSfx(type: SfxType): void {
  // Single chokepoint for the voice-active gate: while the mode② voice partner
  // is up, every cue is silenced so it neither talks over the AI nor leaks into
  // the open mic. The user's own mute preference is enforced separately, by the
  // master gain — this leaves it untouched.
  if (isSfxSuppressed()) return
  const preset = SFX_PRESETS[type]
  if (!preset) return
  const ctx = getAudioContext()
  if (!ctx) return

  if (preset.kind === 'chime') {
    playChime(preset, ctx)
    return
  }

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
      // Route through the shared master gain so a single node enforces mute
      // for every SFX; fall back to the raw destination if it can't be made.
      gain.connect(getMasterGain() ?? ctx.destination)
      src.start(0)
    } catch {
      // Source node creation can throw if ctx was closed; safe to ignore.
    }
  })
}
