/**
 * Background stopwatch tick loop, driven by an `isRunning` boolean.
 *
 * Starts a looping AudioBufferSourceNode of the `tick` sample when
 * `isRunning` flips to true; stops and disposes it when `isRunning` flips
 * to false (or on unmount). Handles React StrictMode's intentional
 * effect double-invoke by always cleaning up the prior source first.
 *
 * Silent-fail: if Web Audio isn't available or the buffer hasn't decoded
 * yet, the loop simply doesn't start. There is no retry — first-frame
 * decode races are a non-issue because the timer only starts after the
 * player has already clicked through the start screen, by which time the
 * audio context has been unlocked and the buffer will typically be ready.
 */

import { useEffect } from 'react'
import { getAudioContext, getBuffer } from '@/audio/audio-context'
import { SFX_PRESETS } from '@/audio/presets'

export function useStopwatchLoop(isRunning: boolean): void {
  useEffect(() => {
    if (!isRunning) return

    let source: AudioBufferSourceNode | null = null
    let cancelled = false

    const preset = SFX_PRESETS['stopwatch-tick']
    const ctx = getAudioContext()
    if (!ctx) return

    void getBuffer(preset.sample).then((buf) => {
      if (cancelled || !buf) return
      try {
        source = ctx.createBufferSource()
        source.buffer = buf
        source.playbackRate.value = preset.rate
        source.loop = true
        source.connect(ctx.destination)
        source.start(0)
      } catch {
        source = null
      }
    })

    return () => {
      cancelled = true
      if (source) {
        try {
          source.stop()
        } catch {
          // Source may already be stopped; safe to ignore.
        }
        try {
          source.disconnect()
        } catch {
          // Already disconnected; safe to ignore.
        }
        source = null
      }
    }
  }, [isRunning])
}
