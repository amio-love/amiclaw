import styles from './FeaturedShadowChase.module.css'

/**
 * Discovery card for the first solo companion game beyond BombSquad.
 * The card owns only the entry link; the game remains a separate SPA.
 */
export default function FeaturedShadowChase() {
  return (
    <section className={styles.section} aria-labelledby="shadow-chase-title">
      <div className={styles.card}>
        <div>
          <p className={styles.kicker}>NEW GAME · AMIO ARCADE</p>
          <h2 id="shadow-chase-title" className={styles.title}>
            Dual Shadow Chase
          </h2>
          <p className={styles.description}>
            A short solo chase where you and your AI companion split, swap, rescue, and escape.
          </p>
          <p className={styles.boundary}>
            One human + one AI companion. Real-time human multiplayer is not part of Arcade.
          </p>
        </div>
        <a className={styles.cta} href="/shadow-chase/">
          Start the chase
        </a>
      </div>
    </section>
  )
}
