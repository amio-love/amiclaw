import Button from '@/components/ui/Button'
import EyebrowTag from '@/components/ui/EyebrowTag'
import StatPill from '@/components/ui/StatPill'
import styles from './AnonHero.module.css'

interface AnonHeroProps {
  /* Routes to the BombSquad landing page (/game) — the primary「开启旅程」CTA. */
  onStart: () => void
  /* Scrolls to the FeaturedBombSquad section — the ghost「看看 BombSquad」CTA. */
  onSeeBombSquad: () => void
}

/* Anonymous homepage hero — left copy column + right planet stage.
   Handoff §6.1. The planet, rings and BombSquad wordmark are decorative
   (aria-hidden); the three floating StatPills carry real platform stats. */
export default function AnonHero({ onStart, onSeeBombSquad }: AnonHeroProps) {
  return (
    <section className={styles.hero}>
      <div>
        <EyebrowTag variant="hero-pill">本周开服 · BOMBSQUAD 公测中</EyebrowTag>
        <h1 className={styles.title}>
          和 <span className={styles.accent}>AI</span> 一起
          <br />
          玩点新的。
          <span className={styles.line2}>a place to play with AI · together</span>
        </h1>
        <p className={styles.sub}>
          Amiclaw 是 AMIO 旗下的人机协作游戏平台。你描述、AI 协助 ——
          一起拆弹、一起合奏、一起把一个想法画进星空。
        </p>
        <div className={styles.cta}>
          <Button variant="primary" onClick={onStart}>
            开启旅程 →
          </Button>
          <Button variant="ghost" onClick={onSeeBombSquad}>
            看看 BombSquad
          </Button>
        </div>
      </div>

      <div className={styles.planetStage}>
        <div className={styles.planetRing2} aria-hidden="true" />
        <div className={styles.planetRing} aria-hidden="true" />
        <div className={styles.planet} aria-hidden="true" />
        <StatPill className={styles.s1} value="1,287" label="本周在线" />
        <StatPill
          className={styles.s2}
          value={
            <>
              42<small className={styles.statUnit}>秒</small>
            </>
          }
          label="最快拆弹"
        />
        <StatPill className={styles.s3} value="3" label="支持 AI 模型" />
      </div>
    </section>
  )
}
