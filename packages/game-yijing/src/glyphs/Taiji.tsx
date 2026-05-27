import type { CSSProperties } from 'react'
import styles from './Taiji.module.css'

/* Taiji 太极 — yin-yang circle. SVG matches handoff prototype/yijing/glyphs.jsx
   Taiji exactly: outer purple-radial disc, yang half-disc with embedded
   yin / yang dots. Slow rotation (24s linear) is owned by sibling 2 — this
   static port just exposes a `.taijiSpin` class hook on the SVG wrapper. */

interface TaijiProps {
  size?: number
  className?: string
  style?: CSSProperties
}

export function Taiji({ size = 130, className, style }: TaijiProps) {
  const classes = [styles.taiji, className].filter(Boolean).join(' ')
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={classes}
      style={style}
    >
      <defs>
        <radialGradient id="tj-yang" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fff7c4" />
          <stop offset="0.7" stopColor="#ffe53e" />
          <stop offset="1" stopColor="#c89400" />
        </radialGradient>
        <radialGradient id="tj-yin" cx="0.6" cy="0.7" r="0.7">
          <stop offset="0" stopColor="#3a2a60" />
          <stop offset="0.6" stopColor="#1a0e36" />
          <stop offset="1" stopColor="#050511" />
        </radialGradient>
      </defs>
      {/* outer ring (yin base) */}
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="url(#tj-yin)"
        stroke="rgba(255,229,62,.35)"
        strokeWidth="0.6"
      />
      {/* yang half (S-curve) */}
      <path
        d="M 50 2
           A 48 48 0 0 0 50 98
           A 24 24 0 0 1 50 50
           A 24 24 0 0 0 50 2 Z"
        fill="url(#tj-yang)"
      />
      {/* embedded dots */}
      <circle cx="50" cy="26" r="6" fill="url(#tj-yin)" />
      <circle cx="50" cy="74" r="6" fill="url(#tj-yang)" />
      <circle cx="50" cy="26" r="2" fill="#ffe53e" opacity="0.9" />
      <circle cx="50" cy="74" r="2" fill="#1a0e36" />
    </svg>
  )
}
