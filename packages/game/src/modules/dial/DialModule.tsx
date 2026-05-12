import { useState } from 'react'
import type { DialConfig, DialAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { getSymbol } from '@shared/symbols'
import { playSfx } from '@/audio/useSfx'
import styles from './DialModule.module.css'

const CLICK_PULSE_MS = 200
const CONFIRM_PULSE_MS = 300

export default function DialModule({
  config,
  answer,
  onComplete,
  onError,
}: ModuleProps<DialConfig, DialAnswer>) {
  const [positions, setPositions] = useState([0, 0, 0])
  const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle')
  const [pulsingArrow, setPulsingArrow] = useState<string | null>(null)
  const [confirmPulsing, setConfirmPulsing] = useState(false)

  const rotate = (dialIndex: number, direction: -1 | 1) => {
    if (flashState !== 'idle') return
    setPositions((prev) => {
      const next = [...prev]
      next[dialIndex] = (next[dialIndex] + direction + 6) % 6
      return next
    })
    playSfx('dial-rotate')
    const key = `${dialIndex}:${direction}`
    setPulsingArrow(key)
    setTimeout(() => {
      setPulsingArrow((curr) => (curr === key ? null : curr))
    }, CLICK_PULSE_MS)
  }

  const confirm = () => {
    if (flashState !== 'idle') return
    playSfx('confirm')
    setConfirmPulsing(true)
    setTimeout(() => setConfirmPulsing(false), CONFIRM_PULSE_MS)
    const correct = answer.positions.every((p, i) => p === positions[i])
    if (correct) {
      setFlashState('success')
      playSfx('module-success')
      setTimeout(onComplete, 800)
    } else {
      setFlashState('error')
      playSfx('module-error')
      onError()
      setTimeout(() => {
        setPositions([0, 0, 0])
        setFlashState('idle')
      }, 600)
    }
  }

  return (
    <div
      className={`${styles.wrapper} ${flashState === 'error' ? styles.error : ''} ${flashState === 'success' ? styles.success : ''}`}
    >
      <div className={styles['dials-container']}>
        {config.dials.map((dial, dialIndex) => {
          const symbolId = dial[positions[dialIndex]]
          let sym
          try {
            sym = getSymbol(symbolId)
          } catch {
            sym = null
          }
          return (
            <div key={dialIndex} className={styles.dial} data-testid={`dial-${dialIndex}`}>
              <div className={styles['dial-window']}>
                {sym ? (
                  <svg
                    viewBox="0 0 100 100"
                    className={styles['symbol-svg']}
                    aria-label={sym.description}
                  >
                    <path d={sym.path} />
                  </svg>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{symbolId}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`${styles['arrow-btn']} ${pulsingArrow === `${dialIndex}:-1` ? styles.clicking : ''}`}
                  onClick={() => rotate(dialIndex, -1)}
                  aria-label={`Rotate dial ${dialIndex + 1} left`}
                  data-testid={`dial-${dialIndex}-left`}
                >
                  ◀
                </button>
                <button
                  className={`${styles['arrow-btn']} ${pulsingArrow === `${dialIndex}:1` ? styles.clicking : ''}`}
                  onClick={() => rotate(dialIndex, 1)}
                  aria-label={`Rotate dial ${dialIndex + 1} right`}
                  data-testid={`dial-${dialIndex}-right`}
                >
                  ▶
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button
        className={`${styles['confirm-btn']} ${confirmPulsing ? styles['confirm-clicking'] : ''}`}
        onClick={confirm}
        data-testid="dial-confirm"
      >
        Confirm
      </button>
    </div>
  )
}
