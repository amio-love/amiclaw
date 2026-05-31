/**
 * Background stopwatch tick, driven by an `isRunning` boolean.
 *
 * Fires `playSfx('stopwatch-tick')` twice per second while `isRunning` is
 * true — the canonical 2 Hz "tick-tock-tick-tock" cadence of a mechanical
 * stopwatch, tuned for urgency. The first tick fires immediately on
 * transition to `isRunning=true` so the player hears the stopwatch start.
 *
 * We use `setInterval` + one-shot SFX rather than a looping
 * `AudioBufferSourceNode` because the base tick sample is ~360ms — looping
 * it tightly produces a ~2.7 Hz "tick-decay-tick-decay" cadence with no
 * silence between, which feels nothing like a real stopwatch. The interval
 * approach gives "tick…silence…tick…silence…" with controlled cadence.
 *
 * Silent-fail: `playSfx` is no-op when Web Audio is unavailable or the
 * buffer hasn't decoded yet.
 */

import { useEffect } from 'react'
import { playSfx } from '@/audio/useSfx'

const TICK_INTERVAL_MS = 500

export function useStopwatchLoop(isRunning: boolean): void {
  useEffect(() => {
    if (!isRunning) return

    // Immediate tick on start so the player gets audio feedback at t=0
    // rather than waiting a full second.
    playSfx('stopwatch-tick')

    const intervalId = setInterval(() => {
      playSfx('stopwatch-tick')
    }, TICK_INTERVAL_MS)

    return () => {
      clearInterval(intervalId)
    }
  }, [isRunning])
}
