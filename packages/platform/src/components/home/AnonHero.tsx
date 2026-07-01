import { Button, EyebrowTag, StatPill, Wordmark } from '@amiclaw/ui'
import { formatMs } from '@shared/format-time'
import type { DailyBoardState } from '@/hooks/useDailyBoard'
import styles from './AnonHero.module.css'

interface AnonHeroProps {
  /* Routes to the BombSquad landing page (window.location.assign('/bombsquad/'))
     — the primary「开始玩」CTA. */
  onStart: () => void
  /* Today's real daily board, fetched once in GamesPage. The floating stat
     pills derive from it — no fabricated numbers. */
  board: DailyBoardState
}

/* Anonymous homepage hero — left copy column + right planet stage.
   Handoff §6.1. The planet and rings are a decorative warm-cosmic orb
   (aria-hidden), matching the BombSquad lobby planet — no game wordmark is
   baked onto the platform hero. The floating StatPills only ever show data we
   actually
   track: 今日上榜 (real daily participation) and 最快拆弹 (today's #1 time)
   come from the daily board — the leader pill hides until the board has a
   score. The static game-count pill reflects the currently playable platform
   surfaces: BombSquad plus the Yijing Oracle preview. There is NO weekly /
   online metric anywhere in the product, so no pill claims one. */
export default function AnonHero({ onStart, board }: AnonHeroProps) {
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
          <span className={styles.subLine}>
            <Wordmark language="zh" />
            是你和 AI 伙伴的轻量体验入口。
          </span>
          <span className={styles.subLine}>带上你的 AI 伙伴，来玩一局。</span>
        </p>
        <div className={styles.cta}>
          <Button variant="primary" onClick={onStart}>
            开始玩 →
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
        <StatPill className={styles.s3} value="2" label="已上线游戏" />
      </div>
    </section>
  )
}
