import Button from '@/components/ui/Button'
import EyebrowTag from '@/components/ui/EyebrowTag'
import { useDailyCountdown } from '@/hooks/useDailyCountdown'
import styles from './DailyChallenge.module.css'

interface DailyChallengeProps {
  /* Opens the daily-challenge PromptModal — the「立即挑战」CTA. */
  onChallenge: () => void
}

/* Daily-challenge card — handoff §6.3. Left column: the daily pitch and
   three thin participation stats. Right column: a live countdown to the
   next UTC 00:00 reset plus the primary CTA. Platform chrome — no cyan. */
export default function DailyChallenge({ onChallenge }: DailyChallengeProps) {
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
              参与 <strong>1,287</strong>
            </div>
            <div className={styles.footItem}>
              日榜首 <strong>00:42</strong>
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
