import { useNavigate } from 'react-router-dom'
import { Button, EyebrowTag, Scenery } from '@amiclaw/ui'
import { getDailyResetHint, getTodayString, toChineseDateString } from '@shared/date'
import { Hexagram, TaijiFrame } from '../glyphs'
import { ganzhi, type YaoSextet } from '../glyphs/utils'
import styles from './PageHome.module.css'

/* Home — handoff §6.1. Cosmic stage + Scenery backdrop, taiji hero, today
   strip, draw-card CTA, BombSquad cross-link. The cast is a real three-coin
   random cast (crypto randomness, full 64-hexagram manual), so the draw card
   carries no demo caveat. */

/* Mini icon on the draw-card — 6-yao mix used by the handoff prototype. */
const DRAW_PREVIEW: YaoSextet = [7, 8, 7, 6, 7, 8]

export function PageHome() {
  const navigate = useNavigate()
  /* Today = the shared UTC product day, so the date, the 干支 stamp and the
     daily checklist all roll over together at the shell's daily reset. */
  const today = getTodayString()
  const gz = ganzhi(today)

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />

      <div className={styles.content}>
        <div className={styles.top}>
          <EyebrowTag variant="hero-pill">投币起卦 · 经典卦辞</EyebrowTag>
        </div>

        <div className={styles.hero}>
          <TaijiFrame className={styles.heroFrame} size={240} />
          <h1 className={styles.title}>
            易<span className={styles.titleAccent}>经</span>
          </h1>
          <div className={styles.titleCn}>签 · 卜 · 卦</div>
          <p className={styles.titleSub}>心中默念一事 · 投币起卦 · 读一段经典卦辞</p>
        </div>

        <div className={styles.rightCol}>
          <div className={styles.today}>
            <div className={styles.todayStamp}>{gz}</div>
            <div className={styles.todayL}>
              <div className={styles.todayLbl}>今日 · {gz}日</div>
              <div className={styles.todayCd}>{toChineseDateString(today)}</div>
              <div className={styles.todayHint}>{getDailyResetHint()}</div>
            </div>
            {/* No ask-count stats here: Yijing has no counter backend, so any
                「已问卦 / 你 第 N 次」number would be fabricated. */}
          </div>

          <div className={styles.drawCard}>
            <div className={styles.drawL}>
              <div className={styles.drawLbl}>今日卦签</div>
              <div className={styles.drawTtl}>投一次硬币，读一卦</div>
              <div className={styles.drawSub}>2–3 分钟 · 三枚硬币起卦 · 生成一张卦签</div>
            </div>
            <div className={styles.drawR}>
              <Hexagram values={DRAW_PREVIEW} size={36} lineH={5} gap={3} />
            </div>
            <div className={styles.drawCta}>
              <Button variant="primary" onClick={() => navigate('/projection')}>
                开始问卦 →
              </Button>
            </div>
          </div>

          <a
            className={styles.crossLink}
            href="https://claw.amio.fans/bombsquad"
            target="_blank"
            rel="noreferrer"
          >
            <span>· 也试试 BombSquad 拆弹小队</span>
            <span className={styles.crossArrow}>→</span>
          </a>
        </div>
      </div>
    </main>
  )
}
