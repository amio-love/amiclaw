import { useState } from 'react'
import type { KeypadConfig, KeypadAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { getSymbol } from '@shared/symbols'
import styles from './KeypadModule.module.css'

export default function KeypadModule({
  config, answer, onComplete, onError,
}: ModuleProps<KeypadConfig, KeypadAnswer>) {
  const [clicked, setClicked] = useState<number[]>([])
  const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle')

  const handleCellClick = (position: number) => {
    if (clicked.includes(position) || flashState !== 'idle') return
    const next = [...clicked, position]
    setClicked(next)

    if (next.length === 4) {
      const correct = next.every((p, i) => p === answer.sequence[i])
      if (correct) {
        setFlashState('success')
        setTimeout(onComplete, 600)
      } else {
        setFlashState('error')
        onError()
        navigator.vibrate?.(200)
        setTimeout(() => { setClicked([]); setFlashState('idle') }, 600)
      }
    }
  }

  return (
    <div
      className={`${styles.grid} ${flashState === 'error' ? styles.error : ''} ${flashState === 'success' ? styles.success : ''}`}
    >
      {config.symbols.map((symbolId, position) => {
        const sym = getSymbol(symbolId)
        const clickOrder = clicked.indexOf(position)
        return (
          <button
            key={position}
            className={`${styles.cell} ${clicked.includes(position) ? styles.selected : ''}`}
            onClick={() => handleCellClick(position)}
            aria-label={sym.description}
            data-testid={`keypad-cell-${position}`}
          >
            <svg viewBox="0 0 100 100" className={styles.symbol}>
              <path d={sym.path} />
            </svg>
            {clickOrder >= 0 && (
              <span className={styles.badge}>{clickOrder + 1}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
