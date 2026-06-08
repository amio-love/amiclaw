import { useNavigate } from 'react-router-dom'
import { AiToolList, BombSquadWordmark, DailyCountdown, Scenery } from '@amiclaw/ui'
import { formatMs } from '@shared/format-time'
import Eyebrow from '@/components/bombsquad/Eyebrow'
import Button from '@/components/bombsquad/Button'
import Glyph from '@/components/bombsquad/Glyph'
import { useDailyBoardStats } from '@/hooks/useDailyBoardStats'
import styles from './BombSquadLandingPage.module.css'

/* BombSquad game landing page — Atlas star-chart visual language
   (design_handoff_bombsquad README §6.1). This is BombSquad's own
   landing, mounted at /bombsquad; the platform homepage at / is separate.
   The 每日挑战 / 练习 CTAs enter the connect-AI flow (/bombsquad/connect),
   which then hands off to the existing run. */
export default function BombSquadLandingPage() {
  const navigate = useNavigate()
  /* Same daily leaderboard API the platform homepage and /leaderboard read.
     Empty board → 日榜首 — and 今日上榜 0; never a fabricated number. The board
     holds only successful defusals, so the count is labelled 今日上榜 (matches
     the platform hero), not 参与. */
  const { participantCount, leaderTimeMs } = useDailyBoardStats()

  /* Each CTA picks a mode and enters the connect-AI flow; the connect
     screen copies the manual link and hands off to the run. */
  const startDaily = () => navigate('/bombsquad/connect?mode=daily')
  const startPractice = () => navigate('/bombsquad/connect?mode=practice')

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />
      <div className={styles.stage}>
        <div className={styles.home}>
          {/* Top strip — bring-your-own-AI premise label + exit-to-platform
              control. This is not a status: the player supplies their own
              voice AI, so the label invites rather than asserting any AI is
              connected. Brand-yellow (not green) keeps it a label, not a
              "ready/online" signal. */}
          <div className={styles.top}>
            <Eyebrow dot color="var(--y)">
              <AiToolList prefix="自带语音 AI · 支持" />
            </Eyebrow>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => window.location.assign('/')}
              aria-label="返回平台首页（claw.amio.fans）"
            >
              {/* Exit-to-platform glyph — a settings gear would imply a
                  settings surface the immersive game does not have. */}
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>

          {/* Planet hero — glowing core glyph, two orbit rings, two dots. */}
          <div className={styles.hero}>
            <div className={styles.planet}>
              <div className={styles.core}>
                <Glyph name="ji" size={64} glow={false} color="#fff" className={styles.heroGlyph} />
              </div>
              <div className={`${styles.ring} ${styles.ring1}`} aria-hidden="true" />
              <div className={`${styles.ring} ${styles.ring2}`} aria-hidden="true" />
              <div className={`${styles.orbitDot} ${styles.dot1}`} aria-hidden="true" />
              <div className={`${styles.orbitDot} ${styles.dot2}`} aria-hidden="true" />
            </div>
            <h1 className={styles.title}>
              <BombSquadWordmark size="lobby" />
            </h1>
            <div className={styles.subtitle}>拆弹小队</div>
            <p className={styles.desc}>人机协作 · 语音拆弹挑战 · 一局 5–8 分钟</p>
          </div>

          {/* Right column — daily card, CTAs, leaderboard link, AI chips.
              `display: contents` until the desktop breakpoint, so mobile
              stacks these straight into the page flex with no wrapper. */}
          <div className={styles.rightCol}>
            <div className={styles.daily}>
              <div>
                <div className={styles.dailyLabel}>今日挑战 · 重置</div>
                <DailyCountdown size="sm" className={styles.countdown} />
              </div>
              <div className={styles.dailyRight}>
                <div className={styles.dailyRank}>
                  日榜首 <strong>{leaderTimeMs !== null ? formatMs(leaderTimeMs) : '—'}</strong>
                </div>
                <div className={styles.dailyRank}>
                  今日上榜 <strong>{participantCount}</strong>
                </div>
              </div>
            </div>

            <div className={styles.ctas}>
              <Button variant="ghost" full onClick={startPractice}>
                练习
              </Button>
              <Button variant="primary" full onClick={startDaily}>
                每日挑战 →
              </Button>
            </div>

            {/* Cross-app link into the platform leaderboard (separate SPA at
                the root), so it is a plain anchor / full-page load, not a
                client-side router Link. */}
            <a href="/leaderboard" className={styles.lbLink}>
              排行榜
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M9 6 L15 12 L9 18" />
              </svg>
            </a>

            <AiToolList prefix="支持" className={styles.chips} />
          </div>
        </div>
      </div>
    </main>
  )
}
