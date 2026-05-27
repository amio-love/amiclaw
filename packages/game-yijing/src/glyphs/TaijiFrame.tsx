import type { CSSProperties } from 'react'
import { Taiji } from './Taiji'
import { Trigram } from './Trigram'
import type { TrigramName } from './utils'
import styles from './TaijiFrame.module.css'

/* TaijiFrame — home-hero composition: 240px frame, centred Taiji disc
   (130px), 8 trigrams arranged in a ring around it. Trigram ring order
   matches Fuxi / Earlier-Heaven 先天八卦 sequence used by the handoff
   bagua ring: 乾 top, 兑 NE, 离 E, 震 SE, 巽 S, 坎 SW, 艮 W, 坤 NW.

   Sizing: disc is ~54% of frame (130 / 240). Trigram ring radius is
   frame/2 − inset (~32px), so the trigrams float just outside the disc.
   Rotation animations live in sibling 2. */

const RING_ORDER: TrigramName[] = ['qian', 'dui', 'li', 'zhen', 'xun', 'kan', 'gen', 'kun']

interface TaijiFrameProps {
  size?: number
  /** Disc size; defaults to ~54% of `size` to match the home-hero layout. */
  discSize?: number
  /** Highlight one trigram in AMIO yellow (e.g. today's trigram). */
  accent?: TrigramName
  className?: string
  style?: CSSProperties
}

export function TaijiFrame({ size = 240, discSize, accent, className, style }: TaijiFrameProps) {
  const resolvedDisc = discSize ?? Math.round(size * (130 / 240))
  const ringRadius = size / 2 - Math.max(20, size * 0.13)
  const tgSize = Math.max(16, Math.round(size * 0.11))

  const wrapperStyle: CSSProperties = { width: size, height: size, ...style }
  const classes = [styles.frame, className].filter(Boolean).join(' ')

  return (
    <div className={classes} style={wrapperStyle}>
      <div className={`${styles.ring} ${styles.ringReverseSpin}`}>
        {RING_ORDER.map((name, i) => {
          const angle = (i * 360) / RING_ORDER.length
          const tgStyle = {
            ['--tg-angle' as string]: `${angle}deg`,
            ['--tg-radius' as string]: `${ringRadius}px`,
          } as CSSProperties
          const tgClasses = [styles.tg, accent === name && styles.accent].filter(Boolean).join(' ')
          return (
            <div key={name} className={tgClasses} style={tgStyle}>
              <Trigram name={name} size={tgSize} color="currentColor" />
            </div>
          )
        })}
      </div>
      <div className={`${styles.disc} ${styles.discSpin}`}>
        <Taiji size={resolvedDisc} />
      </div>
    </div>
  )
}
