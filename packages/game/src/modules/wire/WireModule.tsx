import { useState, useCallback } from 'react'
import type { WireConfig, WireAnswer } from '@shared/manual-schema'
import type { ModuleProps } from '../types'
import { playSfx } from '@/audio/useSfx'
import styles from './WireModule.module.css'

const CLICK_PULSE_MS = 200

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
  const [pulsingWire, setPulsingWire] = useState<number | null>(null)

  const handleClick = useCallback(
    (index: number) => {
      if (state !== 'idle') return
      playSfx('wire-cut')
      setPulsingWire(index)
      setTimeout(() => {
        setPulsingWire((curr) => (curr === index ? null : curr))
      }, CLICK_PULSE_MS)
      if (index === answer.cutPosition) {
        setCutIndex(index)
        setState('cut')
        playSfx('module-success')
        navigator.vibrate?.(100)
        setTimeout(onComplete, 800)
      } else {
        setState('error')
        playSfx('module-error')
        navigator.vibrate?.(200)
        onError()
        setTimeout(() => setState('idle'), 600)
      }
    },
    [state, answer.cutPosition, onComplete, onError]
  )

  const wireCount = config.wires.length
  const svgHeight = 40 + wireCount * 45 + 20

  return (
    <div
      className={`${styles.container} ${state === 'error' ? styles.error : ''} ${state === 'cut' ? styles.success : ''}`}
    >
      <svg
        viewBox={`0 0 300 ${svgHeight}`}
        width="100%"
        style={{ maxWidth: 400, display: 'block', margin: '0 auto' }}
        aria-label="Wire routing panel"
      >
        {config.wires.map((wire, i) => {
          const startY = 40 + i * 45
          const midX = 150
          const midY = startY + (i % 2 === 0 ? 15 : -15)
          const d = `M 20 ${startY} Q ${midX} ${midY} 280 ${startY}`
          const isCut = cutIndex === i

          return (
            <g key={i}>
              {/* Visual wire */}
              {isCut ? (
                <>
                  {/* Top half */}
                  <path
                    d={`M 20 ${startY} Q ${midX * 0.6} ${midY} ${midX - 10} ${startY}`}
                    stroke={COLOR_MAP[wire.color] ?? '#888'}
                    className={styles['wire-cut-top']}
                    strokeWidth={4}
                    fill="none"
                    strokeLinecap="round"
                  />
                  {/* Bottom half */}
                  <path
                    d={`M ${midX + 10} ${startY} Q ${midX * 1.4} ${midY} 280 ${startY}`}
                    stroke={COLOR_MAP[wire.color] ?? '#888'}
                    className={styles['wire-cut-bottom']}
                    strokeWidth={4}
                    fill="none"
                    strokeLinecap="round"
                  />
                </>
              ) : (
                <path
                  d={d}
                  stroke={COLOR_MAP[wire.color] ?? '#888'}
                  className={styles['wire-visual']}
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                />
              )}
              {/* Invisible hit target */}
              <path
                d={d}
                className={`${styles['wire-hit-target']} ${pulsingWire === i ? styles.clicking : ''}`}
                onClick={() => handleClick(i)}
                data-testid={`wire-${i}`}
                aria-label={`Cut wire ${i + 1} (${wire.color})`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleClick(i)}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
