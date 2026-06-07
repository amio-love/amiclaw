import { Button, EyebrowTag, useDailyCountdown } from '@amiclaw/ui'
import { formatMs } from '@shared/format-time'
import type { DailyBoardState } from '@/hooks/useDailyBoard'
import styles from './DailyChallenge.module.css'

interface DailyChallengeProps {
  /* Routes to the BombSquad landing page (window.location.assign('/bombsquad/'))
     — the「立即挑战」CTA. */
  onChallenge: () => void
  /* Today's real daily board, fetched once in GamesPage. Participation count
     and 日榜首 time are derived from it — no fabricated numbers. */
  board: DailyBoardState
}

/* Daily-challenge card — handoff §6.3. Left column: the daily pitch and
   three thin participation stats. Right column: a live countdown to the
   next UTC 00:00 reset plus the primary CTA. Platform chrome — no cyan.

   The 今日上榜 / 日榜首 stats come from the real daily board. An empty board
   renders 今日上榜 0 and 日榜首 — (no leader yet); 你 未参与 stays honest
   because the homepage has no per-player progress signal. The board holds only
   successful defusals, so the count is labelled 今日上榜 (matches AnonHero),
   not 参与. */
export default function DailyChallenge({ onChallenge, board }: DailyChallengeProps) {
  const [hours, minutes, seconds] = useDailyCountdown()

  return (
    <section className={styles.section}>
      <div className={styles.card}>
        <div className={styles.left}>
          <EyebrowTag variant="daily">每日挑战 · DAILY DROP</EyebrowTag>
          <h2 className={styles.title}>今日：四模块连拆 · 90 秒内通关</h2>
          <p className={styles.desc}>
            全球玩家挑战同一套谜题。AI 是你的耳朵和直觉 —— 用最少的时间和最少的失误冲上日榜。
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
          <div className={styles.countdown}>
            <span>{hours}</span>
            <span className={styles.sep}>:</span>
            <span>{minutes}</span>
            <span className={styles.sep}>:</span>
            <span>{seconds}</span>
          </div>
          <div className={styles.units}>
            <span>时</span>
            <span>分</span>
            <span>秒</span>
          </div>
          <Button variant="primary" size="sm" className={styles.cta} onClick={onChallenge}>
            立即挑战 →
          </Button>
        </div>
      </div>
    </section>
  )
}
