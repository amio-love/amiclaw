import { useState, useCallback, type CSSProperties } from 'react'
import type { WireConfig, WireAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { playSfx } from '@/audio/useSfx'
import styles from './WireModule.module.css'

/* Light strings — Atlas-styled reskin of the wire module
   (design_handoff_bombsquad README §6.4). Gameplay is unchanged:
   the player cuts exactly one wire and it is judged on the spot.
   Each strand is drawn as a glowing light string crossing a glass
   stage, with colored anchor pins at both ends. */

const COLOR_MAP: Record<string, string> = {
  red: '#ff073a',
  blue: '#00aaff',
  yellow: '#ffee00',
  green: '#39ff14',
  white: '#e0e0ff',
  black: '#333344',
}

type WireState = 'idle' | 'cut' | 'error'

export default function WireModule({
  config,
  answer,
  onComplete,
  onError,
}: ModuleProps<WireConfig, WireAnswer>) {
  const [state, setState] = useState<WireState>('idle')
  const [cutIndex, setCutIndex] = useState<number | null>(null)
  // Index of the strand the player cut WRONG — drives a red flash + recoil on
  // that one strand (the wire stays intact). Cleared on the same ~600ms reset
  // that returns the panel to 'idle'. Severing is reserved for the correct cut.
  const [errorIndex, setErrorIndex] = useState<number | null>(null)

  const handleClick = useCallback(
    (index: number) => {
      if (state !== 'idle') return
      playSfx('wire-cut')
      if (index === answer.cutPosition) {
        setCutIndex(index)
        setState('cut')
        playSfx('module-success')
        navigator.vibrate?.(100)
        setTimeout(onComplete, 800)
      } else {
        setErrorIndex(index)
        setState('error')
        playSfx('module-error')
        navigator.vibrate?.(200)
        onError()
        setTimeout(() => {
          setState('idle')
          setErrorIndex(null)
        }, 600)
      }
    },
    [state, answer.cutPosition, onComplete, onError]
  )

  const wireCount = config.wires.length
  const svgHeight = 40 + wireCount * 45 + 20

  return (
    <div
      className={`${styles.wrapper} ${state === 'error' ? styles.error : ''} ${state === 'cut' ? styles.success : ''}`}
    >
      <div className={styles.stage}>
        <svg
          viewBox={`0 0 300 ${svgHeight}`}
          width="100%"
          className={styles.svg}
          aria-label="Wire routing panel"
        >
          <defs>
            <filter id="wire-glow" x="-20%" y="-40%" width="140%" height="180%">
              <feGaussianBlur stdDeviation="2.6" />
            </filter>
          </defs>
          {config.wires.map((wire, i) => {
            const startY = 40 + i * 45
            const midX = 150
            const midY = startY + (i % 2 === 0 ? 15 : -15)
            const d = `M 20 ${startY} Q ${midX} ${midY} 280 ${startY}`
            const color = COLOR_MAP[wire.color] ?? '#888'
            const isCut = cutIndex === i
            const isError = errorIndex === i

            return (
              <g key={i}>
                {/* Glow halo — only while the strand is lit. */}
                {!isCut && (
                  <path
                    d={d}
                    stroke={color}
                    strokeWidth={9}
                    fill="none"
                    opacity={0.32}
                    filter="url(#wire-glow)"
                    className={styles.halo}
                  />
                )}
                {isCut ? (
                  <>
                    <path
                      d={`M 20 ${startY} Q ${midX * 0.6} ${midY} ${midX - 10} ${startY}`}
                      stroke={color}
                      className={styles.cutTop}
                      strokeWidth={4}
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d={`M ${midX + 10} ${startY} Q ${midX * 1.4} ${midY} 280 ${startY}`}
                      stroke={color}
                      className={styles.cutBottom}
                      strokeWidth={4}
                      fill="none"
                      strokeLinecap="round"
                    />
                    <circle cx={midX} cy={startY} r={5} className={styles.sparkRing} />
                    <circle cx={midX} cy={startY} r={4} className={styles.sparkCore} />
                  </>
                ) : (
                  <path
                    d={d}
                    stroke={color}
                    className={`${styles.strand} ${isError ? styles.strandError : ''}`}
                    style={isError ? ({ '--wire-color': color } as CSSProperties) : undefined}
                    strokeWidth={3}
                    fill="none"
                    strokeLinecap="round"
                    data-testid={`strand-${i}`}
                  />
                )}
                {/* Anchor pins at both ends. */}
                <circle
                  cx={20}
                  cy={startY}
                  r={5.5}
                  fill={color}
                  className={styles.pin}
                  opacity={isCut ? 0.3 : 1}
                />
                <circle
                  cx={280}
                  cy={startY}
                  r={5.5}
                  fill={color}
                  className={styles.pin}
                  opacity={isCut ? 0.3 : 1}
                />
                {/* Invisible hit target. */}
                <path
                  d={d}
                  className={styles.hitTarget}
                  onClick={() => handleClick(i)}
                  data-testid={`wire-${i}`}
                  aria-label={`Cut wire ${i + 1} (${wire.color})`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleClick(i)
                    }
                  }}
                />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
