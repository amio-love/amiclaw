import { Link, useNavigate } from 'react-router-dom'
import { Button, EyebrowTag, Scenery } from '@amiclaw/ui'
import { Hexagram, TaijiFrame } from '../glyphs'
import { ganzhi, type YaoSextet } from '../glyphs/utils'
import styles from './PageHome.module.css'

/* Home — handoff §6.1. Cosmic stage + Scenery backdrop, taiji hero, today
   strip, draw-card CTA, past-row preview, BombSquad cross-link.
   Past-row hexagram values + ask-counts are stub data (Phase-1 placeholder
   per task IA Boundary §Out — historical persistence is Phase-2 work). */

interface PastEntry {
  date: string
  name: string
  values: YaoSextet
  hex: number
}

/* Three stub previous casts so the past-row reads as real on first visit. */
const PAST_ENTRIES: PastEntry[] = [
  { date: '5 · 26', name: '水风井', values: [8, 7, 7, 8, 7, 8], hex: 48 },
  { date: '5 · 25', name: '山泽损', values: [7, 7, 8, 7, 7, 8], hex: 41 },
  { date: '5 · 24', name: '火天大有', values: [7, 7, 7, 7, 8, 7], hex: 14 },
]

/* Mini icon on the draw-card — 6-yao mix used by the handoff prototype. */
const DRAW_PREVIEW: YaoSextet = [7, 8, 7, 6, 7, 8]

function todayCN(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function PageHome() {
  const navigate = useNavigate()
  const gz = ganzhi()

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />

      <div className={styles.content}>
        <div className={styles.top}>
          <EyebrowTag variant="hero-pill">语音 oracle · 已就位</EyebrowTag>
          <button className={styles.iconBtn} type="button" aria-label="设置">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        <div className={styles.hero}>
          <TaijiFrame className={styles.heroFrame} size={240} />
          <h1 className={styles.title}>
            易<span className={styles.titleAccent}>经</span>
          </h1>
          <div className={styles.titleCn}>签 · 卜 · 卦</div>
          <p className={styles.titleSub}>不说出口，AI 读心 · 卦象解读 · 每日一卦</p>
        </div>

        <div className={styles.rightCol}>
          <div className={styles.today}>
            <div className={styles.todayStamp}>{gz}</div>
            <div className={styles.todayL}>
              <div className={styles.todayLbl}>今日 · {gz}日</div>
              <div className={styles.todayCd}>{todayCN()}</div>
            </div>
            <div className={styles.todayR}>
              <div>
                已问卦 <strong>1,287</strong>
              </div>
              <div>
                你 <strong>第 38 次</strong>
              </div>
            </div>
          </div>

          <div className={styles.drawCard}>
            <div className={styles.drawL}>
              <div className={styles.drawLbl}>今日一卦</div>
              <div className={styles.drawTtl}>投一次硬币，听一卦</div>
              <div className={styles.drawSub}>5–8 分钟 · 语音引导 · 生成一张今日卦签</div>
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

          <div className={styles.pastRow}>
            {PAST_ENTRIES.map((p) => (
              <Link key={p.date} to="/sign" className={styles.pastCard}>
                <div className={styles.pastD}>{p.date}</div>
                <div className={styles.pastN}>{p.name}</div>
                <Hexagram values={p.values} size={28} lineH={4} gap={2} />
              </Link>
            ))}
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
