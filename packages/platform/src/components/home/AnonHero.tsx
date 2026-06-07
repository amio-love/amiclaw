import { Button, EyebrowTag, StatPill } from '@amiclaw/ui'
import { formatMs } from '@shared/format-time'
import type { DailyBoardState } from '@/hooks/useDailyBoard'
import styles from './AnonHero.module.css'

interface AnonHeroProps {
  /* Routes to the BombSquad landing page (window.location.assign('/bombsquad/'))
     — the primary「开启旅程」CTA. */
  onStart: () => void
  /* Scrolls to the FeaturedBombSquad section — the ghost「看看 BombSquad」CTA. */
  onSeeBombSquad: () => void
  /* Today's real daily board, fetched once in GamesPage. The floating stat
     pills derive from it — no fabricated numbers. */
  board: DailyBoardState
}

/* Anonymous homepage hero — left copy column + right planet stage.
   Handoff §6.1. The planet, rings and BombSquad wordmark are decorative
   (aria-hidden). The floating StatPills only ever show data we actually
   track: 今日上榜 (real daily participation) and 最快拆弹 (today's #1 time)
   come from the daily board — the leader pill hides until the board has a
   score — and 支持 AI 模型 is an honest static fact. There is NO weekly /
   online metric anywhere in the product, so no pill claims one. */
export default function AnonHero({ onStart, onSeeBombSquad, board }: AnonHeroProps) {
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
          你描述、AI 协助，一起拆弹。Amiclaw 是 AMIO 的人机协作游戏平台。
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
        <StatPill className={styles.s1} value={board.participantCount} label="今日上榜" />
        {board.leaderTimeMs !== null && (
          <StatPill className={styles.s2} value={formatMs(board.leaderTimeMs)} label="最快拆弹" />
        )}
        <StatPill className={styles.s3} value="3" label="支持 AI 模型" />
      </div>
    </section>
  )
}
