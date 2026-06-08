import styles from './FooterPitch.module.css'

/* Footer pitch — handoff §6.8. Anonymous-only; rendered as the last homepage
   section before the platform footer. A pure pitch block with no play CTA of
   its own. */
export default function FooterPitch() {
  return (
    <section className={styles.pitch}>
      <h2 className={styles.title}>
        带上你的 AI，<span className={styles.accent}>一起玩。</span>
      </h2>
    </section>
  )
}
