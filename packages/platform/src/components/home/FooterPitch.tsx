import styles from './FooterPitch.module.css'

/* Footer pitch — handoff §6.8. Anonymous-only; rendered as the last homepage
   section before the platform footer. A pure pitch block: headline + the
   no-signup / no-tracking promise. The homepage routes to /bombsquad/ only
   via the hero + TopNav, so this section carries no play CTA of its own. */
export default function FooterPitch() {
  return (
    <section className={styles.pitch}>
      <h2 className={styles.title}>
        找个人，找一只 AI，<span className={styles.accent}>一起玩。</span>
      </h2>
      <p className={styles.subtitle}>永久免费，不存档也不出售你的对话。</p>
    </section>
  )
}
