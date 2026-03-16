import { useState } from 'react'
import type { DialConfig, DialAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { getSymbol } from '@shared/symbols'
import styles from './DialModule.module.css'

export default function DialModule({
  config, answer, onComplete, onError,
}: ModuleProps<DialConfig, DialAnswer>) {
  const [positions, setPositions] = useState([0, 0, 0])
  const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle')

  const rotate = (dialIndex: number, direction: -1 | 1) => {
    if (flashState !== 'idle') return
    setPositions(prev => {
      const next = [...prev]
      next[dialIndex] = (next[dialIndex] + direction + 6) % 6
      return next
    })
  }

  const confirm = () => {
    if (flashState !== 'idle') return
    const correct = answer.positions.every((p, i) => p === positions[i])
    if (correct) {
      setFlashState('success')
      setTimeout(onComplete, 800)
    } else {
      setFlashState('error')
      onError()
      setTimeout(() => {
        setPositions([0, 0, 0])
        setFlashState('idle')
      }, 600)
    }
  }

  return (
    <div className={`${styles.wrapper} ${flashState === 'error' ? styles.error : ''} ${flashState === 'success' ? styles.success : ''}`}>
      <div className={styles['dials-container']}>
        {config.dials.map((dial, dialIndex) => {
          const symbolId = dial[positions[dialIndex]]
          let sym
          try { sym = getSymbol(symbolId) } catch { sym = null }
          return (
            <div key={dialIndex} className={styles.dial} data-testid={`dial-${dialIndex}`}>
              <div className={styles['dial-window']}>
                {sym ? (
                  <svg viewBox="0 0 100 100" className={styles['symbol-svg']} aria-label={sym.description}>
                    <path d={sym.path} />
                  </svg>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{symbolId}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={styles['arrow-btn']}
                  onClick={() => rotate(dialIndex, -1)}
                  aria-label={`Rotate dial ${dialIndex + 1} left`}
                  data-testid={`dial-${dialIndex}-left`}
                >
                  ◀
                </button>
                <button
                  className={styles['arrow-btn']}
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
        className={styles['confirm-btn']}
        onClick={confirm}
        data-testid="dial-confirm"
      >
        Confirm
      </button>
    </div>
  )
}
