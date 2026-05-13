import { useState, useRef, useEffect } from 'react'
import type { ButtonConfig, ButtonAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { playSfx } from '@/audio/useSfx'
import styles from './ButtonModule.module.css'

const INDICATOR_COLORS = ['white', 'yellow', 'blue', 'red']
const HOLD_THRESHOLD_MS = 500
const INDICATOR_CYCLE_MS = 800

type ButtonState = 'idle' | 'pressed' | 'holding' | 'success' | 'error'

const CSS_COLORS: Record<string, string> = {
  red: '#ff073a',
  blue: '#00aaff',
  yellow: '#ffee00',
  white: '#e0e0ff',
  green: '#39ff14',
  black: '#333344',
}

export default function ButtonModule({
  config,
  answer,
  onComplete,
  onError,
}: ModuleProps<ButtonConfig, ButtonAnswer>) {
  const [buttonState, setButtonState] = useState<ButtonState>('idle')
  const [indicatorColorIdx, setIndicatorColorIdx] = useState(0)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cycleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handlePointerDown = () => {
    if (buttonState !== 'idle') return
    setButtonState('pressed')
    playSfx('button-down')
    pressTimerRef.current = setTimeout(() => {
      setButtonState('holding')
      cycleIntervalRef.current = setInterval(() => {
        setIndicatorColorIdx((i) => (i + 1) % INDICATOR_COLORS.length)
      }, INDICATOR_CYCLE_MS)
    }, HOLD_THRESHOLD_MS)
  }

  const handlePointerUp = () => {
    // onPointerLeave can fire after onPointerUp has already settled state —
    // only the first call (while still pressed/holding) should resolve the
    // attempt, otherwise we'd double-fire SFX and onError.
    if (buttonState !== 'pressed' && buttonState !== 'holding') return

    if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
    if (cycleIntervalRef.current) {
      clearInterval(cycleIntervalRef.current)
      cycleIntervalRef.current = null
    }

    playSfx('button-up')

    if (buttonState === 'pressed') {
      if (answer.action === 'tap') {
        setButtonState('success')
        playSfx('module-success')
        setTimeout(onComplete, 600)
      } else {
        setButtonState('error')
        playSfx('module-error')
        onError()
        setTimeout(() => setButtonState('idle'), 600)
      }
    } else if (buttonState === 'holding') {
      const releasedColor = INDICATOR_COLORS[indicatorColorIdx]
      if (answer.action === 'hold' && releasedColor === answer.releaseOnColor) {
        setButtonState('success')
        playSfx('module-success')
        setTimeout(onComplete, 600)
      } else {
        setButtonState('error')
        playSfx('module-error')
        onError()
        setTimeout(() => {
          setButtonState('idle')
          setIndicatorColorIdx(0)
        }, 600)
      }
    }
  }

  useEffect(
    () => () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
      if (cycleIntervalRef.current) clearInterval(cycleIntervalRef.current)
    },
    []
  )

  const indicatorColor = CSS_COLORS[INDICATOR_COLORS[indicatorColorIdx]] ?? '#888'
  const buttonBg = CSS_COLORS[config.color] ?? '#444'

  return (
    <div
      className={`${styles.container} ${buttonState === 'error' ? styles.error : ''} ${buttonState === 'success' ? styles.success : ''}`}
      data-testid="button-module"
    >
      <div
        className={styles.indicator}
        style={{
          backgroundColor:
            buttonState === 'holding'
              ? indicatorColor
              : (CSS_COLORS[config.indicatorColor] ?? '#888'),
        }}
        data-testid="button-indicator"
      />
      <button
        className={`${styles['big-button']} ${buttonState === 'pressed' || buttonState === 'holding' ? styles.pressed : ''}`}
        style={{ backgroundColor: buttonBg, color: '#fff' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        data-testid="big-button"
        aria-label={`${config.label} button`}
      >
        {config.label}
      </button>
      <div className={styles.display} data-testid="button-display">
        {config.displayNumber}
      </div>
    </div>
  )
}
