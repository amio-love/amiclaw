import type { CSSProperties, ReactNode } from 'react'
import styles from './PlanetOrb.module.css'

export type PlanetOrbVariant = 'hero' | 'lobby' | 'avatar'

interface PlanetOrbProps {
  /** Which tuning of the shared orb recipe to render. Default `avatar`. */
  variant?: PlanetOrbVariant
  /**
   * Orb diameter in px → `--orb-size` inline. Use for the `avatar` variant
   * (44–56px). `hero` / `lobby` consumers instead set `--orb-size` (and its
   * responsive breakpoints) from their own module via `className`.
   */
  size?: number
  /**
   * `avatar` only — whether the orb breathes. Default true. Muting is a host
   * concern (set `--orb-play-state: paused` on an ancestor); `breathing={false}`
   * hard-stops the animation.
   */
  breathing?: boolean
  /** Positioning / size class from the consumer's own CSS module. */
  className?: string
  style?: CSSProperties
  /** Decorative orb (no glyph child) — mark it away from the a11y tree. */
  ariaHidden?: boolean
  /** Centered content — e.g. the BombSquad glyph inside the `lobby` core. */
  children?: ReactNode
}

/**
 * PlanetOrb — the platform's shared warm-cosmic orb (DesignSystem.md §Companion
 * Presence). One recipe, three variants: the anonymous hero stage orb (`hero`),
 * the BombSquad landing glyph core (`lobby`), and the companion's breathing
 * visible body (`avatar`). CSS-only; dark-only; no cyan.
 */
export default function PlanetOrb({
  variant = 'avatar',
  size,
  breathing = true,
  className,
  style,
  ariaHidden,
  children,
}: PlanetOrbProps) {
  const classes = [
    styles.orb,
    styles[variant],
    variant === 'avatar' && !breathing ? styles.still : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const mergedStyle =
    size !== undefined ? ({ ...style, ['--orb-size']: `${size}px` } as CSSProperties) : style

  return (
    <div className={classes} style={mergedStyle} aria-hidden={ariaHidden || undefined}>
      {children}
    </div>
  )
}
