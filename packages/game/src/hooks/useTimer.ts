import { useState, useEffect, useRef } from 'react'

/**
 * Counts up from a start time (performance.now() timestamp).
 * Updates every animation frame while running.
 * Returns elapsed time in ms and a formatted MM:SS string.
 */
export function useTimer(startTime: number | null, endTime: number | null): { elapsedMs: number; display: string } {
  const [elapsedMs, setElapsedMs] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (startTime === null) {
      setElapsedMs(0)
      return
    }

    if (endTime !== null) {
      setElapsedMs(endTime - startTime)
      return
    }

    const tick = () => {
      setElapsedMs(performance.now() - startTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [startTime, endTime])

  const totalSeconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return { elapsedMs, display }
}
