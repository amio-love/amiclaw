/**
 * The ONLY wall-clock in the botanical app. A single requestAnimationFrame
 * loop measures elapsed real time and feeds it to `onTick(dtMs)` (the engine's
 * host-injected time). It:
 *   - pauses while the tab is hidden (no decay in a backgrounded tab), and
 *     resets its baseline on `visibilitychange` so returning never replays a
 *     huge jump;
 *   - stops entirely when `active` is false (the run has ended).
 *
 * A per-frame safety clamp bounds any throttled-resume gap that dodges the
 * visibility reset; normal frames are ~16ms so the clamp is otherwise inert.
 */
import { useEffect, useRef } from 'react'

const MAX_FRAME_MS = 1000

export function useDecayLoop(onTick: (dtMs: number) => void, active: boolean): void {
  const onTickRef = useRef(onTick)
  useEffect(() => {
    onTickRef.current = onTick
  }, [onTick])

  useEffect(() => {
    if (!active) return
    let raf = 0
    let last: number | null = null

    const frame = (now: number) => {
      if (document.hidden) {
        last = null
      } else {
        if (last === null) last = now
        const dt = now - last
        last = now
        if (dt > 0) onTickRef.current(Math.min(dt, MAX_FRAME_MS))
      }
      raf = requestAnimationFrame(frame)
    }

    const onVisibility = () => {
      if (document.hidden) last = null
    }

    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active])
}
