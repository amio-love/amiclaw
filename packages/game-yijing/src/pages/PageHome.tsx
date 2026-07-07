import { useNavigate } from 'react-router-dom'
import { Button, EyebrowTag, Scenery } from '@amiclaw/ui'
import { Hexagram, TaijiFrame } from '../glyphs'
import { ganzhi, type YaoSextet } from '../glyphs/utils'
import styles from './PageHome.module.css'

/* Home — handoff §6.1. Cosmic stage + Scenery backdrop, taiji hero, today
   strip, draw-card CTA, sample-sign row, BombSquad cross-link.
   The sample row shows OTHER hexagrams as visual examples and is labeled
   样例 — it must never masquerade as the visitor's own play history
   (historical persistence is Phase-2 work). */

interface SampleEntry {
  name: string
  values: YaoSextet
  hex: number
}

/* Three sample hexagrams so first-time visitors see what a sign looks like. */
const SAMPLE_ENTRIES: SampleEntry[] = [
  { name: '水风井', values: [8, 7, 7, 8, 7, 8], hex: 48 },
  { name: '山泽损', values: [7, 7, 8, 7, 7, 8], hex: 41 },
  { name: '火天大有', values: [7, 7, 7, 7, 8, 7], hex: 14 },
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
              <div className={styles.todayCd}>{todayCN()}</div>
            </div>
            {/* No ask-count stats here: Yijing has no counter backend, so any
                「已问卦 / 你 第 N 次」number would be fabricated. */}
          </div>

          <div className={styles.drawCard}>
            <div className={styles.drawL}>
              <div className={styles.drawLbl}>卦例演示</div>
              <div className={styles.drawTtl}>投一次硬币，读一卦</div>
              <div className={styles.drawSub}>2–3 分钟 · 当前为固定卦例 · 生成一张卦签</div>
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

          {/* Display-only samples — not links: tapping one used to open the
              /sign demo card showing a DIFFERENT hexagram than the tile. */}
          <div className={styles.pastRow}>
            {SAMPLE_ENTRIES.map((p) => (
              <div key={p.hex} className={styles.pastCard}>
                <div className={styles.pastD}>样例</div>
                <div className={styles.pastN}>{p.name}</div>
                <Hexagram values={p.values} size={28} lineH={4} gap={2} />
              </div>
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
