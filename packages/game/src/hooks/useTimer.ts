import { useState, useEffect, useRef } from 'react'

/**
 * Counts up from a start time (performance.now() timestamp).
 * Updates every animation frame while running.
 * Returns elapsed time in ms and a formatted MM:SS string.
 */
export function useTimer(startTime: number | null, endTime: number | null): { elapsedMs: number; display: string } {
  const [now, setNow] = useState(() => performance.now())
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (startTime === null || endTime !== null) {
      return
    }

    const tick = () => {
      setNow(performance.now())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [startTime, endTime])

  const elapsedMs = startTime === null ? 0 : (endTime ?? now) - startTime
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return { elapsedMs, display }
}
