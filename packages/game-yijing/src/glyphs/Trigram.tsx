import type { CSSProperties } from 'react'
import type { TrigramName } from './utils'
import styles from './Trigram.module.css'

/* Trigram 八卦 — 3-yao glyph. Eight canonical trigrams keyed by Pinyin,
   each carries chinese name (`cn`), element label (`el`), and 3-bit lines
   (bottom, middle, top — 1 = 阳, 0 = 阴). Used in the home-hero bagua ring
   plus anywhere we need one of the 8 primary trigrams.

   Implementation matches handoff prototype/yijing/glyphs.jsx Trigram —
   absolutely-positioned CSS bars (not Unicode characters), so each line
   inherits `color` and supports the `glow` drop-shadow uniformly. */

export interface TrigramSpec {
  cn: string
  el: string
  lines: readonly [number, number, number] // [bottom, middle, top], 1 = yang
}

export const TRIGRAMS: Record<TrigramName, TrigramSpec> = {
  qian: { cn: '乾', el: '天', lines: [1, 1, 1] }, // ☰
  dui: { cn: '兑', el: '泽', lines: [1, 1, 0] }, // ☱
  li: { cn: '离', el: '火', lines: [1, 0, 1] }, // ☲
  zhen: { cn: '震', el: '雷', lines: [1, 0, 0] }, // ☳
  xun: { cn: '巽', el: '风', lines: [0, 1, 1] }, // ☴
  kan: { cn: '坎', el: '水', lines: [0, 1, 0] }, // ☵
  gen: { cn: '艮', el: '山', lines: [0, 0, 1] }, // ☶
  kun: { cn: '坤', el: '地', lines: [0, 0, 0] }, // ☷
}

interface TrigramProps {
  name: TrigramName
  size?: number
  color?: string
  glow?: boolean
  className?: string
  style?: CSSProperties
}

export function Trigram({
  name,
  size = 32,
  color = 'var(--y, #ffe53e)',
  glow = false,
  className,
  style,
}: TrigramProps) {
  const t = TRIGRAMS[name]
  const lineH = Math.max(2.5, size * 0.085)
  const gap = Math.max(2, size * 0.13)
  const wrapperStyle: CSSProperties = {
    width: size,
    color,
    gap,
    filter: glow ? `drop-shadow(0 0 ${size / 5}px ${color})` : 'none',
    ...style,
  }
  const classes = [styles.trigram, className].filter(Boolean).join(' ')

  return (
    <span className={classes} style={wrapperStyle} aria-label={t.cn}>
      {t.lines.map((y, i) => (
        <span key={i} className={styles.row} style={{ height: lineH, borderRadius: lineH / 2 }}>
          {y ? (
            <span className={styles.barFull} style={{ borderRadius: lineH / 2 }} />
          ) : (
            <>
              <span className={styles.barLeft} style={{ borderRadius: lineH / 2 }} />
              <span className={styles.barRight} style={{ borderRadius: lineH / 2 }} />
            </>
          )}
        </span>
      ))}
    </span>
  )
}
