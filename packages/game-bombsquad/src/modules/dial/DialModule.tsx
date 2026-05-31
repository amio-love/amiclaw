import { useState } from 'react'
import type { DialConfig, DialAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { getSymbol } from '@shared/symbols'
import { playSfx } from '@/audio/useSfx'
import styles from './DialModule.module.css'

/* Astrolabe dials — Atlas-styled reskin of the symbol dial.
   Gameplay is unchanged: three independent dials, each cycling its
   six symbols; the player aligns all three and confirms. The handoff
   star-dial (README §6.3) is a single needle pointing at one of six
   orbiting glyphs — here each of the three dials becomes its own
   mini astrolabe: a glass face, a spring-settled needle marking the
   current 60° position, and a center well showing the live symbol. */

/* Six rotational positions, drawn as orbit ticks around each face. */
const TICKS = [0, 1, 2, 3, 4, 5]

export default function DialModule({
  config,
  answer,
  onComplete,
  onError,
}: ModuleProps<DialConfig, DialAnswer>) {
  const [positions, setPositions] = useState([0, 0, 0])
  const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle')

  const rotate = (dialIndex: number, direction: -1 | 1) => {
    if (flashState !== 'idle') return
    setPositions((prev) => {
      const next = [...prev]
      next[dialIndex] = (next[dialIndex] + direction + 6) % 6
      return next
    })
    playSfx('dial-rotate')
  }

  const confirm = () => {
    if (flashState !== 'idle') return
    playSfx('confirm')
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
      <div className={styles.dials}>
        {config.dials.map((dial, dialIndex) => {
          const position = positions[dialIndex]
          const symbolId = dial[position]
          let sym
          try {
            sym = getSymbol(symbolId)
          } catch {
            sym = null
          }
          return (
            <div key={dialIndex} className={styles.dial} data-testid={`dial-${dialIndex}`}>
              <div className={styles.face}>
                <span className={styles.ring} aria-hidden="true" />
                {TICKS.map((t) => (
                  <span
                    key={t}
                    className={styles.tick}
                    data-on={t === position}
                    style={{ transform: `rotate(${t * 60}deg) translateY(-62px)` }}
                    aria-hidden="true"
                  />
                ))}
                <span
                  className={styles.needle}
                  style={{ transform: `translate(-50%, -100%) rotate(${position * 60}deg)` }}
                  aria-hidden="true"
                >
                  <span className={styles.needleTip} />
                </span>
                <div className={styles.well}>
                  {sym ? (
                    <svg
                      viewBox="0 0 100 100"
                      className={styles.symbol}
                      aria-label={sym.description}
                    >
                      <path d={sym.path} />
                    </svg>
                  ) : (
                    <span className={styles.symbolFallback}>{symbolId}</span>
                  )}
                </div>
              </div>
              <div className={styles.knobs}>
                <button
                  type="button"
                  className={styles.knob}
                  onClick={() => rotate(dialIndex, -1)}
                  aria-label={`Rotate dial ${dialIndex + 1} left`}
                  data-testid={`dial-${dialIndex}-left`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 5a8 8 0 1 0 8 9" />
                    <path d="M23 8v6h-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.knob}
                  onClick={() => rotate(dialIndex, 1)}
                  aria-label={`Rotate dial ${dialIndex + 1} right`}
                  data-testid={`dial-${dialIndex}-right`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 5a8 8 0 1 1 -8 9" />
                    <path d="M1 8v6h6" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" className={styles.confirm} onClick={confirm} data-testid="dial-confirm">
        确认
      </button>
    </div>
  )
}
