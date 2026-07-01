import { useState, useRef, useEffect, type CSSProperties, type KeyboardEvent } from 'react'
import type { ButtonConfig, ButtonAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { playSfx } from '@/audio/useSfx'
import styles from './ButtonModule.module.css'

/* Button module — no dedicated handoff spec; restyled to the Atlas
   star-chart visual language by analogy with the three specced
   modules: a glass stage, a soft glow vocabulary, and the yellow
   accent. Gameplay (tap vs. hold-and-release-on-color) is unchanged. */

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

  // Keyboard parity for the press-and-hold mechanic: Enter / Space map to
  // the same press / release the pointer path uses, so the button module is
  // fully operable without a pointer. `e.repeat` filters the OS key-repeat
  // that fires while a key is held, so a hold registers as one press.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (e.repeat) return
    handlePointerDown()
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    handlePointerUp()
  }

  const releaseColorName = INDICATOR_COLORS[indicatorColorIdx]
  const releaseColor = CSS_COLORS[releaseColorName] ?? '#888'
  const previewColor = CSS_COLORS[config.indicatorColor] ?? '#888'
  const buttonBg = CSS_COLORS[config.color] ?? '#444'
  const isPressed = buttonState === 'pressed' || buttonState === 'holding'
  const isHolding = buttonState === 'holding'
  const buttonAccessibleName = `${config.color} ${config.label} button, display ${config.displayNumber}`
  const lightAccessibleState = isHolding
    ? `Release strip is ${releaseColorName}. Preview light is ${config.indicatorColor}.`
    : `Preview light is ${config.indicatorColor}.`
  const releaseStripStyle = {
    '--release-color': releaseColor,
  } as CSSProperties

  return (
    <div
      className={`${styles.wrapper} ${buttonState === 'error' ? styles.error : ''} ${buttonState === 'success' ? styles.success : ''}`}
      data-testid="button-module"
    >
      <div className={styles.stage}>
        <div className={styles.lightPanel}>
          <div
            className={styles.previewLight}
            style={{
              backgroundColor: previewColor,
              boxShadow: `0 0 10px ${previewColor}`,
            }}
            data-color={config.indicatorColor}
            data-testid="button-preview-light"
            aria-hidden="true"
          />
          {/* The release strip is a separate surface from the static preview
              light. It activates only after the hold threshold and cycles the
              same four colors for every answer target, so it does not encode
              answer.releaseOnColor. */}
          <div
            className={`${styles.releaseStrip} ${isHolding ? styles.releaseStripActive : ''}`}
            style={releaseStripStyle}
            data-active={isHolding ? 'true' : 'false'}
            data-color={isHolding ? releaseColorName : 'inactive'}
            data-testid="button-release-strip"
            aria-hidden="true"
          >
            <div
              key={isHolding ? indicatorColorIdx : 'idle'}
              className={`${styles.releaseStripFill} ${isHolding ? styles.advancePulse : ''}`}
            />
          </div>
        </div>
        <div className={styles.buttonOrbit}>
          <span id="button-module-state" className={styles.srOnly} aria-live="polite">
            {lightAccessibleState}
          </span>
          <button
            type="button"
            className={`${styles.bigButton} ${isPressed ? styles.pressed : ''}`}
            style={{ backgroundColor: buttonBg, color: '#fff' }}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            data-testid="big-button"
            aria-label={buttonAccessibleName}
            aria-describedby="button-module-state"
          >
            {config.label}
          </button>
        </div>
        <div className={styles.display} data-testid="button-display">
          {config.displayNumber}
        </div>
      </div>
    </div>
  )
}
