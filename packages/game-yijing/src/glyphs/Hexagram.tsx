import type { CSSProperties } from 'react'
import { Yao } from './Yao'
import type { YaoSextet } from './utils'
import styles from './Hexagram.module.css'

/* Hexagram 卦象 — six Yao stacked bottom-up. `values[0]` is 初爻 (bottom).
   `drawn` (0..6) caps how many yao are visible; hidden yao still occupy
   layout space so the stack height does not jump.

   `values` shape is fixed at 6 yao to match casting-engine output
   `{ yaoValues: number[] }` (arch-component-casting-engine §Interface).
   Animations (fade-in / translateY per-yao) are owned by sibling 2. */

interface HexagramProps {
  values: YaoSextet
  /* Total stack width in px. Default 120 mirrors handoff prototype. */
  size?: number
  /* Per-yao row height. Default 14 matches handoff `lineH=14` at size 120. */
  lineH?: number
  /* Gap between yao rows. Default 6 matches handoff README §5. */
  gap?: number
  /* How many yao to render visibly, 0..6. Default 6 = full. */
  drawn?: number
  className?: string
  style?: CSSProperties
}

export function Hexagram({
  values,
  size = 120,
  lineH = 14,
  gap = 6,
  drawn = 6,
  className,
  style,
}: HexagramProps) {
  const wrapperStyle: CSSProperties = { width: size, gap, ...style }
  const classes = [styles.hexStack, className].filter(Boolean).join(' ')

  return (
    <div className={classes} style={wrapperStyle}>
      {values.map((v, i) => {
        const visible = i < drawn
        const rowClasses = [styles.hexRow, !visible && styles.hexRowHidden]
          .filter(Boolean)
          .join(' ')
        /* `--yao-idx` drives the per-yao stagger in Hexagram.module.css
           (`animation-delay: calc(var(--yao-idx) * 60ms)`). `i` is the
           bottom-up index 0..5 — initial yao reveals first. */
        const rowStyle = {
          ['--yao-idx' as string]: i,
          height: lineH,
        } as CSSProperties
        return (
          <div key={i} className={rowClasses} style={rowStyle}>
            {visible && <Yao value={v} size={size} height={lineH} />}
          </div>
        )
      })}
    </div>
  )
}
