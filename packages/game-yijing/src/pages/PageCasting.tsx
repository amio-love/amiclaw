import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@amiclaw/ui'
import { CoinTrio, Hexagram, Yao } from '../glyphs'
import {
  changedValues,
  hexagramFromBinary,
  yaoLabel,
  type CoinSide,
  type YaoSextet,
  type YaoValue,
} from '../glyphs/utils'
import { hexagramByNumber } from '../manual'
import { useSession } from '../session'
import styles from './PageCasting.module.css'

/* PageCasting — handoff §6.3 起卦.

   Six coin throws deterministically resolve to DEMO_VALUES = [7, 8, 9, 7, 7, 7]
   (bottom-up), producing 天火同人 #13 with one changing line at 九三 → 天雷无妄
   #25. The fixed cast is DECLARED to the player as a 卦例演示 (demo example) —
   the UI must never present it as a random cast. Real randomness
   (crypto.getRandomValues per three-coin throw) is blocked on content: the
   manual carries judgment/line texts for only 3 of 64 hexagrams, and shipping
   a random cast whose reading text exists for 3/64 outcomes would be a worse
   lie than the labeled demo. Swap in real randomness only together with the
   full 64-hexagram manual dataset. */

const DEMO_VALUES: YaoSextet = [7, 8, 9, 7, 7, 7]
const FLIP_MS = 850
const STEP_LABEL = ['初', '二', '三', '四', '五', '上']

/** Map a yao value back to canonical coin sides for visual continuity. */
function sidesFor(v: YaoValue): readonly CoinSide[] {
  // 3 heads → 9, 2 heads → 8, 1 head → 7, 0 heads → 6.
  return (
    {
      6: ['tails', 'tails', 'tails'],
      7: ['heads', 'tails', 'tails'],
      8: ['heads', 'heads', 'tails'],
      9: ['heads', 'heads', 'heads'],
    } as const
  )[v]
}

/** Fill the unfinished hexagram with placeholder yang so Hexagram can
 *  still receive a fixed-shape sextet; `drawn={N}` hides the unset rows. */
function pad(values: readonly YaoValue[]): YaoSextet {
  const tail = Array(6 - values.length).fill(7 as YaoValue) as YaoValue[]
  return [...values, ...tail] as unknown as YaoSextet
}

export function PageCasting() {
  const { setYaoValues } = useSession()
  const navigate = useNavigate()

  const [throwIdx, setThrowIdx] = useState(0) // 0..6 — number of throws completed
  const [flipping, setFlipping] = useState(false)
  const [sides, setSides] = useState<readonly CoinSide[]>(['heads', 'heads', 'tails'])

  const valuesSoFar = DEMO_VALUES.slice(0, throwIdx)
  const lastValue = valuesSoFar[valuesSoFar.length - 1] as YaoValue | undefined
  const done = throwIdx >= 6

  // Push the final sextet into the session as soon as the 6th throw lands so
  // /reading and /sign can rely on yaoValues being set.
  useEffect(() => {
    if (done) setYaoValues(DEMO_VALUES)
  }, [done, setYaoValues])

  const doThrow = () => {
    if (done) {
      navigate('/reading')
      return
    }
    setFlipping(true)
    const nextV = DEMO_VALUES[throwIdx] as YaoValue
    window.setTimeout(() => {
      setSides(sidesFor(nextV))
      setFlipping(false)
      setThrowIdx((i) => i + 1)
    }, FLIP_MS)
  }

  const reset = () => {
    setThrowIdx(0)
    setSides(['heads', 'heads', 'tails'])
    setFlipping(false)
  }

  const [benNumber, benName] = hexagramFromBinary(DEMO_VALUES)
  const variantValues = changedValues(DEMO_VALUES) as unknown as YaoSextet
  const [bianNumber, bianName] = hexagramFromBinary(variantValues)
  const benJudgment = hexagramByNumber(benNumber)?.judgment.classical

  // Progress index for the run-header step pill — current throw is N+1
  // until done.
  const stepIndex = done ? 6 : Math.min(throwIdx + 1, 6)

  const resultPill = (() => {
    if (done) return null
    if (lastValue === undefined) {
      return (
        <div className={`${styles.resultPill} ${styles.resultPlaceholder}`}>
          <span>点「投币」开始第 1 爻</span>
        </div>
      )
    }
    return (
      <div className={styles.resultPill}>
        <span className={styles.resultNum}>{lastValue}</span>
        <span>{yaoLabel(lastValue)}</span>
        <span className={styles.resultIcon}>
          <Yao value={lastValue} size={40} height={10} />
        </span>
      </div>
    )
  })()

  const primaryLabel = done
    ? '继续 · 读卦辞 →'
    : flipping
      ? '投掷中…'
      : throwIdx === 0
        ? '投币 →'
        : `投第 ${throwIdx + 1} 爻 →`

  return (
    <main className={styles.page}>
      <header className={styles.runHeader}>
        <Link to="/projection" className={styles.iconBtn} aria-label="返回 心象">
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
        </Link>
        <div className={styles.title}>起卦</div>
        <div className={styles.meta}>
          <div className={styles.metaLead}>{done ? '完成' : `第 ${stepIndex} / 6 次`}</div>
          <div className={styles.metaSub}>投币 · 第 2 步 · 卦例演示</div>
        </div>
      </header>

      <section className={styles.cast}>
        {/* 6-segment progress bar */}
        <div className={styles.prog}>
          {Array.from({ length: 6 }).map((_, i) => {
            const cls = [
              styles.seg,
              i < throwIdx && styles.segDone,
              i === throwIdx && !done && styles.segActive,
            ]
              .filter(Boolean)
              .join(' ')
            return <span key={i} className={cls} />
          })}
        </div>

        {/* coin dish */}
        <div className={styles.dish}>
          <CoinTrio sides={sides} flipping={flipping} size={88} />
        </div>

        {/* result pill OR reveal panel */}
        {!done ? (
          <div className={styles.result}>{resultPill}</div>
        ) : (
          <div className={styles.reveal}>
            <div className={styles.revealHexRow}>
              <Hexagram values={DEMO_VALUES} size={88} lineH={11} gap={5} />
              <div className={styles.revealArrow}>→</div>
              <Hexagram values={variantValues} size={88} lineH={11} gap={5} />
            </div>
            <div className={styles.revealName}>
              <span className={styles.revealNameBen}>{benName}</span>
              <span className={styles.revealNameArrow}>→</span>
              <span className={styles.revealNameBian}>{bianName}</span>
            </div>
            <div className={styles.revealMeta}>
              卦例演示 · 本卦 #{benNumber} · 变卦 #{bianNumber} · 变爻在九三
            </div>
            {benJudgment && <div className={styles.revealJudgment}>「{benJudgment}」</div>}
          </div>
        )}

        {/* hex-building sidebar (only while building, not on reveal) */}
        {!done && (
          <div className={styles.hexCard}>
            <div className={styles.hexHead}>
              <span className={styles.hexLabel}>本卦 · 构建中</span>
              <span className={styles.hexCount}>{throwIdx} / 6 爻</span>
            </div>
            <div className={styles.hexBody}>
              <div className={styles.hexNumbers}>
                {Array.from({ length: 6 }).map((_, i) => {
                  const v = valuesSoFar[i]
                  const cls = [styles.numCell, v && styles.numCellOn].filter(Boolean).join(' ')
                  return (
                    <div key={i} className={cls}>
                      {v ? (
                        <>
                          <span className={styles.numV}>{v}</span>
                          <span>·</span>
                          <span className={styles.numDigit}>{STEP_LABEL[i]}</span>
                        </>
                      ) : (
                        <span>{STEP_LABEL[i]} 爻</span>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Re-key on throwIdx so `drawn-grow` replays each throw. */}
              <div key={throwIdx} className={styles.hexAnim}>
                <Hexagram
                  values={pad(valuesSoFar)}
                  drawn={throwIdx}
                  size={108}
                  lineH={12}
                  gap={6}
                />
              </div>
            </div>
          </div>
        )}

        {/* CTA row — the ghost button replays the SAME fixed demo cast, so it
            is labeled as a replay, never as a re-randomization. */}
        <div className={styles.cta}>
          <Button variant="ghost" onClick={reset} className={styles.ctaFull}>
            重看演示
          </Button>
          <Button
            variant="primary"
            onClick={doThrow}
            disabled={flipping}
            className={styles.ctaFull}
          >
            {primaryLabel}
          </Button>
        </div>
      </section>
    </main>
  )
}
