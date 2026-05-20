import { useEffect } from 'react'
import { playSfx } from '@/audio/useSfx'
import styles from './ExplosionOverlay.module.css'

/**
 * Full-screen, CSS-only detonation spectacle shown over the bomb panel for
 * ~1.4s when a daily run fails (3 strikes or the countdown hitting zero).
 *
 * Every motion is a `@keyframes` — no JS animation library (hard project
 * constraint). The `prefers-reduced-motion` fallback in the stylesheet drops
 * the screen shake and the shockwave rings, keeping a single red flash and a
 * static "BOOM" so the failure still reads without vestibular motion.
 *
 * Sound: the SFX bank has no dedicated explosion sample yet, so the low
 * `module-error` thud is reused as a placeholder (a real explosion sample is
 * a followup). `playSfx` is silent-fail when audio is unavailable.
 */
export default function ExplosionOverlay() {
  useEffect(() => {
    playSfx('module-error')
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
