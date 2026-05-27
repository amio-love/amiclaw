import type { CSSProperties } from 'react'
import { Coin } from './Coin'
import type { CoinSide } from './utils'
import styles from './CoinTrio.module.css'

/* CoinTrio — three Coins in a row. `flipping` is a placeholder prop that
   ships through to a `.flipping` class on each slot, ready for the sibling 2
   `coinFlip` keyframes. While `flipping` is true the per-coin glow is
   suppressed (matches handoff: `glow={!flipping && s === 'heads'}`). */

interface CoinTrioProps {
  /* Three coin sides. Variable length allowed to mirror handoff
     prototype/yijing/glyphs.jsx CoinTrio default-arg shape, but production
     callers should always pass exactly 3. */
  sides?: readonly CoinSide[]
  /* Placeholder: animation hook only — no @keyframes attached in this port. */
  flipping?: boolean
  size?: number
  className?: string
  style?: CSSProperties
}

const DEFAULT_SIDES: readonly CoinSide[] = ['heads', 'heads', 'heads']

export function CoinTrio({
  sides = DEFAULT_SIDES,
  flipping = false,
  size = 88,
  className,
  style,
}: CoinTrioProps) {
  const classes = [styles.trio, className].filter(Boolean).join(' ')
  return (
    <div className={classes} style={style}>
      {sides.map((s, i) => {
        const slotClasses = [styles.coinSlot, flipping && 'flipping'].filter(Boolean).join(' ')
        return (
          <div key={i} className={slotClasses} style={{ animationDelay: `${i * 0.08}s` }}>
            <Coin side={s} size={size} glow={!flipping && s === 'heads'} />
          </div>
        )
      })}
    </div>
  )
}
