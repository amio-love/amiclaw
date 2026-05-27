import { useNavigate } from 'react-router-dom'
import { Button, Scenery } from '@amiclaw/ui'
import { Hexagram } from '../glyphs'
import { changedValues, ganzhi, hexagramFromBinary, type YaoSextet } from '../glyphs/utils'
import { useSession } from '../session'
import styles from './PageSign.module.css'

/* Sign — handoff §6.5. Shareable oracle card with header / hex row /
   judgment / divider / insight / vermilion seal foot. Demo data falls back
   to 同人 #13 → 无妄 #25 when the session hasn't cast yet (e.g. direct
   navigation, Phase-1 persistence is sessionStorage-only). */

/* Fallback to the canonical demo cast result (handoff prototype). */
const DEMO_YAO: YaoSextet = [7, 8, 9, 7, 7, 7]

const JUDGMENT = '同人于野，亨。利涉大川，利君子贞。'
const INSIGHT =
  '在协同与方向之间，你正寻求一致。占据更高视角，便能看见同心而异轨者亦可同人——主动停一停，不是放弃，是让真正的同行人显形。'

function todayCN(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function PageSign() {
  const navigate = useNavigate()
  const { yaoValues } = useSession()

  const values: YaoSextet = yaoValues ?? DEMO_YAO
  const changed = changedValues(values) as unknown as YaoSextet
  const [, benCn] = hexagramFromBinary(values)
  const [, bianCn] = hexagramFromBinary(changed)

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />

      <div className={styles.content}>
        <div className={styles.header}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate('/home')}
            aria-label="返回"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M15 4 L7 12 L15 20" />
            </svg>
          </button>
          <div className={styles.headerTitle}>今日卦签</div>
          <div className={styles.headerMeta}>
            <div className={styles.headerStep}>完成</div>
            <div className={styles.headerSub}>可分享</div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardLbl}>amiclaw oracle · 卦签</span>
            <span className={styles.cardDate}>{todayCN()}</span>
          </div>

          <div className={styles.hexRow}>
            <div className={`${styles.col} ${styles.colBen}`}>
              <Hexagram values={values} size={80} lineH={10} gap={5} />
              <span className={styles.colTtl}>{benCn}</span>
              <span className={styles.colRole}>本卦 · {benCn}</span>
            </div>
            <span className={styles.hexArrow}>→</span>
            <div className={`${styles.col} ${styles.colBian}`}>
              <Hexagram values={changed} size={80} lineH={10} gap={5} />
              <span className={styles.colTtl}>{bianCn}</span>
              <span className={styles.colRole}>变卦 · {bianCn}</span>
            </div>
          </div>

          <div className={styles.judgment}>{JUDGMENT}</div>

          <div className={styles.divider}>AI 洞见</div>

          <div className={styles.insight}>{INSIGHT}</div>

          <div className={styles.foot}>
            <div className={styles.footUrl}>claw.amio.fans/oracle</div>
            <div className={styles.seal}>
              <span className={styles.sealL1}>{benCn}</span>
              <span className={styles.sealL2}>{ganzhi()}</span>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <Button variant="primary">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ marginRight: 6 }}
            >
              <path d="M4 12 v8 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-8" />
              <path d="M16 6 L12 2 L8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            分享卦签
          </Button>
          <Button variant="ghost">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ marginRight: 6 }}
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
            </svg>
            复制卦签
          </Button>
          <Button variant="ghost" onClick={() => navigate('/casting')}>
            再问一次
          </Button>
          <button type="button" className={styles.textLink} onClick={() => navigate('/home')}>
            ← 回首页
          </button>
        </div>
      </div>
    </main>
  )
}
