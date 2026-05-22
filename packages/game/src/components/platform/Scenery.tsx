import styles from './Scenery.module.css'

interface Star {
  x: number
  y: number
  delay: number
  duration: number
  size: number
}

type SceneryAccent = 'yellow' | 'green' | 'rose'

interface SceneryProps {
  /* When set, renders the BombSquad game-stage scenery — viewport-
     sized glows tinted to the accent. Omitted → the platform
     homepage scenery (unchanged). */
  accent?: SceneryAccent
}

/* The star fields are fixed decorative layouts — generated once at
   module load, not during render, so they stay stable across mounts
   and keep the component render pure (no impure Math.random() call
   in render). */
const STARS: Star[] = Array.from({ length: 40 }, () => ({
  x: Math.random() * 100,
  y: Math.random() * 100,
  delay: Math.random() * 3,
  duration: 2 + Math.random() * 3,
  size: Math.random() > 0.85 ? 3 : 2,
}))

/* BombSquad game-stage star field — 26 smaller, denser stars. */
const GAME_STARS: Star[] = Array.from({ length: 26 }, () => ({
  x: Math.random() * 100,
  y: Math.random() * 100,
  delay: Math.random() * 3,
  duration: 2.4 + Math.random() * 2.5,
  size: Math.random() > 0.85 ? 2.5 : 1.6,
}))

/* Accent → [g1, g2, g3] radial-glow colors (handoff README §5.1). */
const GAME_GLOWS: Record<SceneryAccent, [string, string, string]> = {
  yellow: ['rgba(255, 229, 62, 0.3)', 'rgba(180, 120, 255, 0.2)', 'rgba(74, 158, 255, 0.18)'],
  green: ['rgba(75, 210, 102, 0.32)', 'rgba(255, 229, 62, 0.18)', 'rgba(100, 200, 255, 0.18)'],
  rose: ['rgba(255, 107, 157, 0.28)', 'rgba(180, 120, 255, 0.2)', 'rgba(255, 229, 62, 0.1)'],
}

function starStyle(star: Star) {
  return {
    left: `${star.x}%`,
    top: `${star.y}%`,
    width: star.size,
    height: star.size,
    animationDelay: `${star.delay}s`,
    animationDuration: `${star.duration}s`,
  }
}

/* Fixed decorative background — 3 radial glows + a twinkling star
   field. `position: fixed`, so it does not scroll with the page.
   Default renders the platform homepage scenery; pass `accent` for
   the BombSquad game-stage variant. */
export default function Scenery({ accent }: SceneryProps) {
  if (accent) {
    const glows = GAME_GLOWS[accent]
    return (
      <div className={`${styles.scenery} ${styles.game}`} aria-hidden="true">
        {glows.map((color, i) => (
          <div
            key={i}
            className={`${styles.gameGlow} ${styles[`gg${i + 1}`]}`}
            style={{ background: `radial-gradient(circle, ${color}, transparent 60%)` }}
          />
        ))}
        {GAME_STARS.map((star, i) => (
          <div key={i} className={styles.star} style={starStyle(star)} />
        ))}
      </div>
    )
  }

  return (
    <div className={styles.scenery} aria-hidden="true">
      <div className={`${styles.glow} ${styles.g1}`} />
      <div className={`${styles.glow} ${styles.g2}`} />
      <div className={`${styles.glow} ${styles.g3}`} />
      {STARS.map((star, i) => (
        <div key={i} className={styles.star} style={starStyle(star)} />
      ))}
    </div>
  )
}
