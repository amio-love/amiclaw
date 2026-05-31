import { useState } from 'react'
import type { KeypadConfig, KeypadAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { getSymbol } from '@shared/symbols'
import { playSfx } from '@/audio/useSfx'
import styles from './KeypadModule.module.css'

/* Constellation — Atlas-styled reskin of the keypad module
   (design_handoff_bombsquad README §6.5). Gameplay is unchanged:
   the four symbols are tapped in order and judged once all four are
   down. The 2×2 grid becomes a scattered star map; each tap extends
   a drawn path between the stars. */

/* Fixed scatter positions (percent of the square stage), one per
   symbol index — an irregular layout that reads as a constellation. */
const STAR_MAP: { x: number; y: number }[] = [
  { x: 26, y: 30 },
  { x: 73, y: 22 },
  { x: 79, y: 70 },
  { x: 33, y: 78 },
]

export default function KeypadModule({
  config,
  answer,
  onComplete,
  onError,
}: ModuleProps<KeypadConfig, KeypadAnswer>) {
  const [clicked, setClicked] = useState<number[]>([])
  const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle')

  const handleCellClick = (position: number) => {
    if (clicked.includes(position) || flashState !== 'idle') return
    const next = [...clicked, position]
    setClicked(next)
    playSfx('keypad-press')

    if (next.length === 4) {
      const correct = next.every((p, i) => p === answer.sequence[i])
      if (correct) {
        setFlashState('success')
        playSfx('module-success')
        setTimeout(onComplete, 600)
      } else {
        setFlashState('error')
        playSfx('module-error')
        onError()
        navigator.vibrate?.(200)
        setTimeout(() => {
          setClicked([])
          setFlashState('idle')
        }, 600)
      }
    }
  }

  /* Path connecting the tapped stars, in tap order. */
  const pathD = clicked
    .map((pos, i) => `${i === 0 ? 'M' : 'L'} ${STAR_MAP[pos].x} ${STAR_MAP[pos].y}`)
    .join(' ')

  return (
    <div
      className={`${styles.wrapper} ${flashState === 'error' ? styles.error : ''} ${flashState === 'success' ? styles.success : ''}`}
    >
      <div className={styles.stage}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className={styles.lines}
          aria-hidden="true"
        >
          {/* Faint star net between every pair. */}
          {STAR_MAP.map((a, i) =>
            STAR_MAP.slice(i + 1).map((b, j) => (
              <line
                key={`${i}-${j}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={styles.netLine}
              />
            ))
          )}
          {/* Player's tap path. */}
          {pathD && <path d={pathD} className={styles.path} />}
        </svg>
        {config.symbols.map((symbolId, position) => {
          const sym = getSymbol(symbolId)
          const clickOrder = clicked.indexOf(position)
          const tapped = clickOrder >= 0
          const star = STAR_MAP[position]
          return (
            <button
              key={position}
              type="button"
              className={`${styles.star} ${tapped ? styles.tapped : ''}`}
              style={{ left: `${star.x}%`, top: `${star.y}%` }}
              onClick={() => handleCellClick(position)}
              aria-label={sym.description}
              data-testid={`keypad-cell-${position}`}
            >
              <svg viewBox="0 0 100 100" className={styles.symbol}>
                <path d={sym.path} />
              </svg>
              {tapped && <span className={styles.badge}>{clickOrder + 1}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
