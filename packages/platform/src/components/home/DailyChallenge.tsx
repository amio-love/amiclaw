import { DailyCountdown, EyebrowTag } from '@amiclaw/ui'
import { formatMs } from '@shared/format-time'
import type { DailyBoardState } from '@/hooks/useDailyBoard'
import styles from './DailyChallenge.module.css'

interface DailyChallengeProps {
  /* Today's real daily board, fetched once in GamesPage. Participation count
     and 日榜首 time are derived from it — no fabricated numbers. */
  board: DailyBoardState
}

/* Daily-challenge card — handoff §6.3. A pure info card: left column carries
   the daily pitch and three thin participation stats, right column a live
   countdown to the next UTC 00:00 reset. No play CTA — the homepage routes
   to /bombsquad/ only via the hero + TopNav. Platform chrome — no cyan.

   The 今日上榜 / 日榜首 stats come from the real daily board. An empty board
   renders 今日上榜 0 and 日榜首 — (no leader yet); 你 未参与 stays honest
   because the homepage has no per-player progress signal. The board holds only
   successful defusals, so the count is labelled 今日上榜 (matches AnonHero),
   not 参与. */
export default function DailyChallenge({ board }: DailyChallengeProps) {
  return (
    <section className={styles.section}>
      <div className={styles.card}>
        <div className={styles.left}>
          <EyebrowTag variant="daily">每日挑战 · DAILY DROP</EyebrowTag>
          <h2 className={styles.title}>今日：四模块连拆</h2>
          <p className={styles.desc}>
            全球玩家同一套谜题。你描述面板，AI 查手册。用时越短，名次越高。
          </p>
          <div className={styles.foot}>
            <div className={styles.footItem}>
              今日上榜 <strong>{board.participantCount}</strong>
            </div>
            <div className={styles.footItem}>
              日榜首{' '}
              <strong>{board.leaderTimeMs !== null ? formatMs(board.leaderTimeMs) : '—'}</strong>
            </div>
            <div className={styles.footItem}>
              你 <strong>未参与</strong>
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <DailyCountdown size="lg" />
        </div>
      </div>
    </section>
  )
}
