import { useEffect } from 'react'
import { playSfx } from '@/audio/useSfx'
import styles from './ExplosionOverlay.module.css'

/**
 * Full-screen, CSS-only detonation spectacle shown over the bomb panel for
 * ~1.4s when a daily run fails. The only daily failure path is the 3-strike
 * rule — time is a stopwatch score, never a detonator, so a cap-out does not
 * trigger this overlay.
 *
 * Every motion is a `@keyframes` — no JS animation library (hard project
 * constraint). The `prefers-reduced-motion` fallback in the stylesheet drops
 * the screen shake and the shockwave rings, keeping a single red flash and a
 * static "BOOM" so the failure still reads without vestibular motion.
 *
 * Sound: a dedicated `explosion` detonation sample fires once on mount.
 * `playSfx` is silent-fail when audio is unavailable.
 */
export default function ExplosionOverlay() {
  useEffect(() => {
    playSfx('explosion')
  }, [])

  return (
    <div className={styles.overlay} role="alert" aria-label="炸弹爆炸">
      <div className={styles.flash} />
      <div className={styles.shockwave} />
      <div className={styles.shockwaveDelayed} />
      <div className={styles.boom}>BOOM</div>
    </div>
  )
}
