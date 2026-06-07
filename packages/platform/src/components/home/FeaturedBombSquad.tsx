import { Button, Chip, SectionHeader, accentClass } from '@amiclaw/ui'
import { formatMs } from '@shared/format-time'
import type { DailyBoardState } from '@/hooks/useDailyBoard'
import styles from './FeaturedBombSquad.module.css'

/* The AI tools BombSquad supports — rendered as cyan chips inside the
   art panel. Mono, uppercase, neon: the BombSquad register. */
const AI_CHIPS = ['CLAUDE', 'CHATGPT', 'GEMINI', 'VOICE_MODE']

/* The mini board mirrors the daily leaderboard's visual budget: a handful
   of top rows. The full board lives at /leaderboard. */
const MINI_ROW_BUDGET = 4

interface FeaturedBombSquadProps {
  /* Routes to the BombSquad landing page (window.location.assign('/bombsquad/'))
     — the「开始一局」CTA. */
  onStartDaily: () => void
  /* Routes to the BombSquad landing page (window.location.assign('/bombsquad/'))
     — the「练习」CTA. */
  onStartPractice: () => void
  /* Routes to the BombSquad landing page (window.location.assign('/bombsquad/'))
     — the section header's「游戏页 →」action. The landing page owns the daily /
     practice choice. */
  onOpenGamePage: () => void
  /* Today's real daily board, fetched once in GamesPage. The mini panel
     renders its top rows — or an honest empty state — never mock players. */
  board: DailyBoardState
}

/* Featured BombSquad section — handoff §6.4. The left art panel is the
   BombSquad zone: the cyan wordmark, mono mark, cyan chips and scanline
   overlay all stay inside it. The right mini-leaderboard panel and the
   section header are platform chrome — no cyan there.

   The mini board reads the real daily leaderboard (same source as
   /leaderboard 每日 and the rest of the homepage). When today's board is
   empty it shows the daily board's own empty-state wording instead of
   fabricated rows; the panel is labelled 今日日榜 because the data resets
   daily at UTC 0. */
export default function FeaturedBombSquad({
  onStartDaily,
  onStartPractice,
  onOpenGamePage,
  board,
}: FeaturedBombSquadProps) {
  const topRows = board.entries.slice(0, MINI_ROW_BUDGET)

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
            <h3 className={styles.sideTitle}>今日日榜</h3>
            <p className={styles.sideBlurb}>
              每天零点重置。把手册念给 AI 听，让它做你的眼睛 —— 用时越短，名次越高。
            </p>
          </div>

          {topRows.length > 0 ? (
            <div className={styles.lbMini}>
              <div className={styles.lbHead}>
                <span>名次</span>
                <span>玩家</span>
                <span className={styles.lbScoreHead}>用时</span>
              </div>
              {topRows.map((row) => {
                const rowClass = [styles.lbRow, row.rank <= 3 ? styles.lbRowTop : '']
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
          ) : (
            <p className={styles.lbEmpty}>今日还没有成绩，来抢第一！</p>
          )}

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
