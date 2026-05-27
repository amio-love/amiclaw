import type { CSSProperties } from 'react'
import type { YaoValue } from './utils'
import styles from './Yao.module.css'

/* Single yao 爻 line, rendered as SVG. Maps a value 6/7/8/9 to:
   - 7 少阳 → solid yellow line
   - 8 少阴 → broken violet line
   - 6 老阴 → broken violet line + ○ marker + extra glow
   - 9 老阳 → solid yellow line + × marker + extra glow

   Visual spec — handoff README §5 字形 + prototype/yijing/glyphs.jsx Yao:
   line weight = row height × 0.42, round caps, broken line = two 40%
   segments with a 20% gap, changing-yao glow = drop-shadow 6px @ 60% alpha. */

interface YaoProps {
  value: YaoValue
  /* Width in px. Default 120 matches handoff prototype default. */
  size?: number
  /* Optional row-height override. Defaults to 14 to preserve handoff
     line-weight × 0.42 = 5.88px (same as `lineH=14`). */
  height?: number
  className?: string
  style?: CSSProperties
}

export function Yao({ value, size = 120, height = 14, className, style }: YaoProps) {
  const isYang = value === 7 || value === 9
  const isChanging = value === 6 || value === 9
  const stroke = isYang ? 'var(--yj-yang, #ffe53e)' : 'var(--yj-yin, #b478ff)'
  const glow = isYang ? 'rgba(255,229,62,.6)' : 'rgba(180,120,255,.6)'
  // Static drop-shadow color uses literal rgba (CSS var inside drop-shadow
  // alpha-suffix `<color>80` is unreliable across engines).
  const staticGlow = isYang ? 'rgba(255,229,62,.5)' : 'rgba(180,120,255,.5)'
  const filter = isChanging ? `drop-shadow(0 0 6px ${glow})` : `drop-shadow(0 0 2px ${staticGlow})`

  const w = size
  const h = height
  const y = h / 2
  const lw = h * 0.42 // line weight ≈ 40% of row height (handoff §5)

  const wrapperStyle: CSSProperties = { filter, ...style }
  const classes = [styles.yao, className].filter(Boolean).join(' ')

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      xmlns="http://www.w3.org/2000/svg"
      className={classes}
      style={wrapperStyle}
    >
      {isYang ? (
        <line
          x1={2}
          y1={y}
          x2={w - 2}
          y2={y}
          stroke={stroke}
          strokeWidth={lw}
          strokeLinecap="round"
        />
      ) : (
        <>
          <line
            x1={2}
            y1={y}
            x2={w * 0.4}
            y2={y}
            stroke={stroke}
            strokeWidth={lw}
            strokeLinecap="round"
          />
          <line
            x1={w * 0.6}
            y1={y}
            x2={w - 2}
            y2={y}
            stroke={stroke}
            strokeWidth={lw}
            strokeLinecap="round"
          />
        </>
      )}
      {isChanging &&
        (isYang ? (
          // × marker — changing yang (老阳)
          <g stroke={stroke} strokeWidth={lw * 0.55} strokeLinecap="round" opacity="0.95">
            <line x1={w / 2 - h * 0.36} y1={y - h * 0.36} x2={w / 2 + h * 0.36} y2={y + h * 0.36} />
            <line x1={w / 2 - h * 0.36} y1={y + h * 0.36} x2={w / 2 + h * 0.36} y2={y - h * 0.36} />
          </g>
        ) : (
          // ○ marker — changing yin (老阴)
          <circle
            cx={w / 2}
            cy={y}
            r={h * 0.38}
            fill="none"
            stroke={stroke}
            strokeWidth={lw * 0.55}
          />
        ))}
    </svg>
  )
}
