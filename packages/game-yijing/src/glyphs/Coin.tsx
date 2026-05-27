import type { CSSProperties } from 'react'
import type { CoinSide } from './utils'
import styles from './Coin.module.css'

/* Coin 铜钱 — round disc with square center hole. Heads (字) face inscribes
   「乾坤同人」 in Noto Serif SC at four corners; tails (背) shows four
   compass-point dots. Per handoff prototype/yijing/glyphs.jsx Coin —
   radial gradients hand-tuned for the gold and dark-violet faces.

   Gradient ids are suffixed with `size` (the only changing input) so two
   coins of different sizes don't share / overwrite each other's <defs>. */

interface CoinProps {
  side?: CoinSide
  /* Default 88 matches the casting screen `<CoinTrio size={88}>` (handoff §6.3). */
  size?: number
  glow?: boolean
  className?: string
  style?: CSSProperties
}

export function Coin({ side = 'heads', size = 88, glow = false, className, style }: CoinProps) {
  const heads = side === 'heads'
  const idH = `coin-h-${size}`
  const idT = `coin-t-${size}`
  const filter = glow
    ? 'drop-shadow(0 0 14px rgba(255,229,62,.55))'
    : 'drop-shadow(0 4px 8px rgba(0,0,0,.4))'
  const wrapperStyle: CSSProperties = { width: size, height: size, filter, ...style }
  const classes = [styles.coin, className].filter(Boolean).join(' ')

  return (
    <span className={classes} style={wrapperStyle}>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        <defs>
          <radialGradient id={idH} cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#fff4b3" />
            <stop offset="0.45" stopColor="#ffe53e" />
            <stop offset="0.85" stopColor="#a87800" />
            <stop offset="1" stopColor="#604200" />
          </radialGradient>
          <radialGradient id={idT} cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#5a4e80" />
            <stop offset="0.55" stopColor="#2a1f4c" />
            <stop offset="1" stopColor="#0c061c" />
          </radialGradient>
        </defs>
        {/* coin body */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill={`url(#${heads ? idH : idT})`}
          stroke={heads ? 'rgba(160,110,0,.7)' : 'rgba(110,90,160,.5)'}
          strokeWidth="1.2"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={heads ? 'rgba(120,80,0,.4)' : 'rgba(180,120,255,.25)'}
          strokeWidth="0.6"
        />
        {/* square hole */}
        <rect
          x="42"
          y="42"
          width="16"
          height="16"
          fill="#050511"
          stroke={heads ? 'rgba(120,80,0,.55)' : 'rgba(110,90,160,.4)'}
          strokeWidth="0.8"
        />
        {heads ? (
          <g
            fontFamily="'Noto Serif SC', serif"
            fontSize="14"
            textAnchor="middle"
            fill="#5a3e00"
            fontWeight="700"
            opacity="0.75"
          >
            <text x="50" y="26">
              乾
            </text>
            <text x="74" y="55">
              坤
            </text>
            <text x="50" y="84">
              同
            </text>
            <text x="26" y="55">
              人
            </text>
          </g>
        ) : (
          <g fill="rgba(180,120,255,.7)">
            <circle cx="50" cy="22" r="1.6" />
            <circle cx="78" cy="50" r="1.6" />
            <circle cx="50" cy="78" r="1.6" />
            <circle cx="22" cy="50" r="1.6" />
          </g>
        )}
      </svg>
    </span>
  )
}
