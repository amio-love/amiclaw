import type { CSSProperties, ReactElement } from 'react'
import styles from './Glyph.module.css'

export type GlyphKey = 'ji' | 'yue' | 'xian' | 'zhong' | 'yi' | 'luo'

export const GLYPH_KEYS: GlyphKey[] = ['ji', 'yue', 'xian', 'zhong', 'yi', 'luo']

/* Single-character label the AI voice partner calls each glyph by —
   「极」「月」… (design_handoff_bombsquad README §5.2). */
export const GLYPH_LABELS: Record<GlyphKey, string> = {
  ji: '极',
  yue: '月',
  xian: '弦',
  zhong: '钟',
  yi: '漪',
  luo: '螺',
}

/* SVG path data copied verbatim from design_handoff_bombsquad
   prototype/bombsquad/glyphs.jsx — hand-tuned, do not redraw.
   40×40 viewBox, currentColor stroke, round caps / joins. */
const PATHS: Record<GlyphKey, ReactElement> = {
  /* 极 — eight-point compass star, sharp and stellar */
  ji: (
    <>
      <path
        d="M20 3 L21.5 18.5 L37 20 L21.5 21.5 L20 37 L18.5 21.5 L3 20 L18.5 18.5 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M9 9 L19 19 M31 9 L21 19 M31 31 L21 21 M9 31 L19 21"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle cx="20" cy="20" r="1.6" fill="currentColor" />
    </>
  ),

  /* 月 — crescent with companion dot */
  yue: (
    <>
      <path
        d="M26 5 a16 16 0 1 0 0 30 a12 12 0 0 1 0 -30 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="13" r="1.6" fill="currentColor" />
    </>
  ),

  /* 弦 — bowstring: arc + chord */
  xian: (
    <>
      <path
        d="M5 30 a16 16 0 0 1 30 -2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M5 30 L35 28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="5" cy="30" r="1.8" fill="currentColor" />
      <circle cx="35" cy="28" r="1.8" fill="currentColor" />
    </>
  ),

  /* 钟 — pendulum: stem + weight + arc */
  zhong: (
    <>
      <path d="M20 5 L20 26" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="20" cy="30" r="5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9 11 a14 14 0 0 1 22 0"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle cx="20" cy="5" r="1.5" fill="currentColor" />
    </>
  ),

  /* 漪 — three concentric arcs (ripple) */
  yi: (
    <>
      <path
        d="M8 25 a6 6 0 0 1 24 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M4 25 a10 10 0 0 1 32 0"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M0 25 a14 14 0 0 1 40 0"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.4"
      />
      <circle cx="20" cy="25" r="1.6" fill="currentColor" />
    </>
  ),

  /* 螺 — spiral curl */
  luo: (
    <>
      <path
        d="M20 20 m0 -2 a2 2 0 1 1 -0.01 0 M20 14 a6 6 0 1 1 -6 6 M20 8 a12 12 0 1 1 -12 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="20" cy="20" r="1.4" fill="currentColor" />
    </>
  ),
}

interface GlyphProps {
  name: GlyphKey
  size?: number
  /* Adds a size/4 yellow drop-shadow halo. */
  glow?: boolean
  color?: string
  className?: string
}

/* One of the six BombSquad celestial glyphs, drawn as a line SVG.
   `color` sets the stroke (via currentColor); `glow` adds a yellow
   halo scaled to the glyph size. */
export default function Glyph({
  name,
  size = 40,
  glow = true,
  color = 'var(--y)',
  className,
}: GlyphProps) {
  const wrapperStyle: CSSProperties = {
    width: size,
    height: size,
    color,
    filter: glow
      ? `drop-shadow(0 0 ${Math.round(size / 4)}px rgba(255, 229, 62, 0.55))`
      : undefined,
  }
  const classes = [styles.glyph, className].filter(Boolean).join(' ')
  return (
    <span className={classes} style={wrapperStyle}>
      <svg
        viewBox="0 0 40 40"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {PATHS[name]}
      </svg>
    </span>
  )
}
