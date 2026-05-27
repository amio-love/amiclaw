import type { CSSProperties, ReactElement } from 'react'
import styles from './ProjArt.module.css'

/* ProjArt 心象 — six abstract Kandinsky / Miro-style projection tiles.
   SVG compositions are copied VERBATIM from handoff
   prototype/yijing/glyphs.jsx `PROJ` — per handoff §3 + §9 the production
   build will swap these placeholders for curated public-domain abstract art
   (30+ image pool, daily seeded), but during Phase 1 scaffold we keep the
   six fixed compositions as-is so projection-engine wiring can be
   validated against a deterministic asset set.

   Each SVG uses unique gradient ids (`pa-sun`, `pc-band`, `pe-wash`) lifted
   from the source. They are file-scoped here; reusing two ProjArts of the
   same id on one page is fine since the gradient definitions are identical.
*/

export type ProjArtId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'

export const PROJ_KEYS: readonly ProjArtId[] = ['a', 'b', 'c', 'd', 'e', 'f']

/* Per-id psychological dimension weights — verbatim from handoff
   `window.PROJ_DIMENSIONS`. Sums to ≈ 1 per tile; used downstream by
   projection-engine to infer which life-area the player gravitated to. */
export const PROJ_DIMENSIONS: Record<ProjArtId, Record<string, number>> = {
  a: { relationship: 0.35, growth: 0.5, identity: 0.15 },
  b: { career: 0.45, growth: 0.4, relationship: 0.15 },
  c: { identity: 0.5, growth: 0.3, finance: 0.2 },
  d: { relationship: 0.6, identity: 0.25, growth: 0.15 },
  e: { health: 0.4, identity: 0.35, growth: 0.25 },
  f: { career: 0.35, finance: 0.35, growth: 0.3 },
}

const PROJ: Record<ProjArtId, ReactElement> = {
  /* 1 — big yellow sun + violet wave (Miro vibe) */
  a: (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="pa-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe53e" />
          <stop offset="0.7" stopColor="#e8a93e" />
          <stop offset="1" stopColor="#a86b1a" />
        </radialGradient>
      </defs>
      <rect width="120" height="120" fill="#1a1530" />
      <circle cx="44" cy="42" r="28" fill="url(#pa-sun)" />
      <path
        d="M 6 90 Q 30 70 60 92 T 116 88"
        fill="none"
        stroke="#b478ff"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="92" cy="34" r="3" fill="#fff" />
      <line
        x1="100"
        y1="56"
        x2="110"
        y2="70"
        stroke="#ff6b9d"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  /* 2 — three layered organic blobs */
  b: (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" fill="#0b1232" />
      <path
        d="M 20 30 Q 60 10 95 25 Q 110 50 80 70 Q 40 80 22 60 Q 8 45 20 30 Z"
        fill="#4a9eff"
        opacity="0.7"
      />
      <path
        d="M 40 55 Q 75 40 100 60 Q 105 88 75 95 Q 45 100 40 80 Q 35 65 40 55 Z"
        fill="#ffe53e"
        opacity="0.75"
      />
      <ellipse cx="62" cy="78" rx="14" ry="9" fill="#ff6b9d" opacity="0.85" />
      <circle cx="86" cy="38" r="2.5" fill="#fff" />
    </svg>
  ),
  /* 3 — warm diagonal stripe + scattered dots */
  c: (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pc-band" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ff6b9d" />
          <stop offset="0.5" stopColor="#ffa849" />
          <stop offset="1" stopColor="#ffe53e" />
        </linearGradient>
      </defs>
      <rect width="120" height="120" fill="#1a0e36" />
      <polygon points="0,75 45,5 120,5 120,40 75,115 0,115" fill="url(#pc-band)" opacity="0.85" />
      <circle cx="20" cy="30" r="3" fill="#fff" />
      <circle cx="92" cy="92" r="4" fill="#b478ff" />
      <circle cx="100" cy="68" r="2.5" fill="#fff" />
      <circle cx="14" cy="100" r="2.5" fill="#4a9eff" />
    </svg>
  ),
  /* 4 — off-center spiral + crescent */
  d: (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" fill="#050a22" />
      <path
        d="M 45 60
           m 0 -3
           a 3 3 0 1 1 0.01 0
           M 45 52 a 11 11 0 1 1 -11 11
           M 45 42 a 21 21 0 1 1 -21 21
           M 45 30 a 33 33 0 1 1 -33 33"
        stroke="#b478ff"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M 92 28 a 22 22 0 1 0 0 56 a 16 16 0 0 1 0 -56 Z" fill="#ffe53e" opacity="0.95" />
      <circle cx="96" cy="98" r="3.5" fill="#ff6b9d" />
    </svg>
  ),
  /* 5 — watercolor wash + black wedge */
  e: (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="pe-wash" cx="0.3" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#4a9eff" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#b478ff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#0b1232" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="120" fill="#08081a" />
      <ellipse cx="55" cy="55" rx="65" ry="50" fill="url(#pe-wash)" />
      <path d="M 70 10 L 115 30 L 95 100 L 80 90 Z" fill="#050511" opacity="0.9" />
      <circle cx="30" cy="35" r="6" fill="#ffe53e" opacity="0.8" />
      <line x1="20" y1="95" x2="60" y2="105" stroke="#fff" strokeWidth="1.5" opacity="0.5" />
    </svg>
  ),
  /* 6 — Miro cluster: dots, lines, triangles */
  f: (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" fill="#1a1a2e" />
      <circle cx="36" cy="38" r="14" fill="none" stroke="#ff6b9d" strokeWidth="3" />
      <circle cx="84" cy="32" r="6" fill="#ffe53e" />
      <line
        x1="60"
        y1="60"
        x2="98"
        y2="92"
        stroke="#4a9eff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="86"
        x2="50"
        y2="98"
        stroke="#4a9eff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <polygon points="76,68 92,68 84,82" fill="#b478ff" />
      <circle cx="42" cy="100" r="3" fill="#fff" />
      <circle cx="60" cy="46" r="2" fill="#fff" />
      <circle cx="105" cy="62" r="2.5" fill="#ff6b9d" />
    </svg>
  ),
}

interface ProjArtProps {
  id: ProjArtId
  selected?: boolean
  /** Rank within the player's selection (1 or 2). Renders the corner badge. */
  selectionOrder?: 1 | 2
  /* Default 120 mirrors handoff prototype tile size; the projection grid
     overrides this with `aspect-ratio: 1 + width: 100%` via the tile CSS. */
  size?: number
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function ProjArt({
  id,
  selected = false,
  selectionOrder,
  size = 120,
  onClick,
  className,
  style,
}: ProjArtProps) {
  const tileStyle: CSSProperties = { width: size, height: size, ...style }
  const classes = [styles.tile, selected && styles.on, className].filter(Boolean).join(' ')
  return (
    <button type="button" className={classes} style={tileStyle} onClick={onClick}>
      <span className={styles.svg}>{PROJ[id]}</span>
      {selected && selectionOrder !== undefined && (
        <span className={styles.badge}>{selectionOrder}</span>
      )}
    </button>
  )
}
