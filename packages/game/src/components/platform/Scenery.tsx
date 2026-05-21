import styles from './Scenery.module.css'

interface Star {
  x: number
  y: number
  delay: number
  duration: number
  size: number
}

/* The star field is a fixed decorative layout — generated once at module
   load, not during render, so it stays stable across mounts and keeps the
   component render pure (no impure Math.random() call in render). */
const STARS: Star[] = Array.from({ length: 40 }, () => ({
  x: Math.random() * 100,
  y: Math.random() * 100,
  delay: Math.random() * 3,
  duration: 2 + Math.random() * 3,
  size: Math.random() > 0.85 ? 3 : 2,
}))

/* Fixed decorative background — 3 radial glows + 40 twinkling stars.
   `position: fixed`, so it does not scroll with the page content. */
export default function Scenery() {
  return (
    <div className={styles.scenery} aria-hidden="true">
      <div className={`${styles.glow} ${styles.g1}`} />
      <div className={`${styles.glow} ${styles.g2}`} />
      <div className={`${styles.glow} ${styles.g3}`} />
      {STARS.map((star, i) => (
        <div
          key={i}
          className={styles.star}
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            animationDelay: `${star.delay}s`,
            animationDuration: `${star.duration}s`,
          }}
        />
      ))}
    </div>
  )
}
