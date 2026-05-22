import Button from '@/components/ui/Button'
import Chip from '@/components/ui/Chip'
import SectionHeader, { accentClass } from '@/components/ui/SectionHeader'
import { featuredMini } from '@/mocks/leaderboard'
import { formatMs } from '@/utils/format-time'
import styles from './FeaturedBombSquad.module.css'

/* The AI tools BombSquad supports — rendered as cyan chips inside the
   art panel. Mono, uppercase, neon: the BombSquad register. */
const AI_CHIPS = ['CLAUDE', 'CHATGPT', 'GEMINI', 'VOICE_MODE']

interface FeaturedBombSquadProps {
  /* Routes to the BombSquad landing page (/game) — the「开始一局」CTA. */
  onStartDaily: () => void
  /* Routes to the BombSquad landing page (/game) — the「练习」CTA. */
  onStartPractice: () => void
  /* Routes to the BombSquad landing page (/game) — the section header's
     「游戏页 →」action. The landing page owns the daily / practice choice. */
  onOpenGamePage: () => void
}

/* Featured BombSquad section — handoff §6.4. The left art panel is the
   BombSquad zone: the cyan wordmark, mono mark, cyan chips and scanline
   overlay all stay inside it. The right mini-leaderboard panel and the
   section header are platform chrome — no cyan there. */
export default function FeaturedBombSquad({
  onStartDaily,
  onStartPractice,
  onOpenGamePage,
}: FeaturedBombSquadProps) {
  return (
    <section className={styles.section} id="featured">
      <SectionHeader
        eyebrow="本周聚焦 · NOW PLAYING"
        title={
          <>
            BombSquad · <span className={accentClass}>拆弹小队</span>
          </>
        }
        action={{ label: '游戏页 →', onClick: onOpenGamePage }}
      />

      <div className={styles.card}>
        <div className={styles.art}>
          <div className={styles.mark}>// AMIO · CLAW / GAME_01</div>
          <div className={styles.bigTitle}>
            BOMB
            <br />
            SQUAD
          </div>
          <div className={styles.meta}>
            <div className={styles.metaBlurb}>人机协作 · 语音拆弹 · 4 模块 · 5–8 分钟一局</div>
            <div className={styles.chips}>
              {AI_CHIPS.map((chip) => (
                <Chip key={chip} variant="cyan">
                  {chip}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.side}>
          <div>
            <h3 className={styles.sideTitle}>本周日榜</h3>
            <p className={styles.sideBlurb}>
              每天零点重置。把手册念给 AI 听，让它做你的眼睛 —— 用时越短，名次越高。
            </p>
          </div>

          <div className={styles.lbMini}>
            <div className={styles.lbHead}>
              <span>名次</span>
              <span>玩家</span>
              <span className={styles.lbScoreHead}>用时</span>
            </div>
            {featuredMini.map((row) => {
              const isYou = row.nickname.includes('你')
              const rowClass = [
                styles.lbRow,
                row.rank <= 3 ? styles.lbRowTop : '',
                isYou ? styles.lbRowYou : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <div key={row.rank} className={rowClass}>
                  <span className={styles.rk}>#{String(row.rank).padStart(2, '0')}</span>
                  <span className={styles.nm}>{row.nickname}</span>
                  <span className={styles.sc}>{formatMs(row.time_ms)}</span>
                </div>
              )
            })}
          </div>

          <div className={styles.ctaRow}>
            <Button
              variant="primary"
              size="sm"
              className={styles.ctaPrimary}
              onClick={onStartDaily}
            >
              开始一局
            </Button>
            <Button variant="ghost" size="sm" onClick={onStartPractice}>
              练习
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
