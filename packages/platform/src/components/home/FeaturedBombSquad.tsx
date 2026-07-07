import { AiToolList, BombSquadWordmark, DailyCountdown } from '@amiclaw/ui'
import { getDailyResetHint } from '@shared/date'
import styles from './FeaturedBombSquad.module.css'

/* Featured BombSquad section — handoff §6.4. The left art panel is the
   BombSquad zone: the white+yellow BombSquadWordmark, the brand-yellow AI
   chips and the scanline overlay sit on a warm-cosmic atmosphere (no cyan —
   DesignSystem.md §Brand). The right status panel carries only the daily
   challenge countdown. Leaderboard data lives on the leaderboard surfaces,
   not in this game overview card.

   The gameplay preview is a REAL screenshot of a live daily run mid-defuse
   (captured from production at a phone viewport) — honest UI, no mockup.
   Explicit width/height attributes pin the aspect ratio so the lazy-loaded
   image causes no layout shift. The cyan inside it is game content (the wire
   module), not chrome styling — cyan stays wire-only. */
export default function FeaturedBombSquad() {
  return (
    <section className={styles.section} id="featured">
      <div className={styles.card}>
        <div className={styles.art}>
          <div className={styles.artContent}>
            <div className={styles.artTop}>
              <span className={styles.kicker}>正在开放 · NOW PLAYING</span>
              <BombSquadWordmark size="hero" className={styles.bigTitle} />
            </div>
            <div className={styles.meta}>
              <div className={styles.metaBlurb}>人机协作 · 语音拆弹 · 5–8 分钟一局</div>
              <AiToolList variant="chips" className={styles.tools} />
            </div>
          </div>
          <img
            className={styles.artShot}
            src="/previews/bombsquad-daily.webp"
            width={480}
            height={1039}
            loading="lazy"
            alt="BombSquad 每日挑战实拍：拆弹进行中的光弦模块与计时器"
          />
        </div>

        <div className={styles.side}>
          <div className={styles.dailyPanel}>
            <h3 className={styles.sideTitle}>今日挑战</h3>
            <DailyCountdown size="lg" className={styles.countdown} />
            <p className={styles.resetHint}>{getDailyResetHint()}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
