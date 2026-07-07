import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@amiclaw/ui'
import { castThrow, type CoinThrow } from '../casting'
import { CoinTrio, Hexagram, Yao } from '../glyphs'
import {
  changedValues,
  changingLines,
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

   Every tap performs a REAL three-coin throw (crypto.getRandomValues, see
   src/casting.ts): yao values 6/7/8/9 land with the canonical
   1/8 · 3/8 · 3/8 · 1/8 odds. Six throws build the 本卦 bottom-up; changing
   lines (6/9) derive the 变卦. The ghost CTA discards the throws and starts a
   fresh cast (重新起卦). */

const FLIP_MS = 850
const STEP_LABEL = ['初', '二', '三', '四', '五', '上']

/** Fill the unfinished hexagram with placeholder yang so Hexagram can
 *  still receive a fixed-shape sextet; `drawn={N}` hides the unset rows. */
function pad(values: readonly YaoValue[]): YaoSextet {
  const tail = Array(6 - values.length).fill(7 as YaoValue) as YaoValue[]
  return [...values, ...tail] as unknown as YaoSextet
}

export function PageCasting() {
  const { setYaoValues } = useSession()
  const navigate = useNavigate()

  const [throws, setThrows] = useState<CoinThrow[]>([])
  const [flipping, setFlipping] = useState(false)
  const [sides, setSides] = useState<readonly CoinSide[]>(['heads', 'heads', 'tails'])

  const valuesSoFar = throws.map((t) => t.value)
  const lastValue = valuesSoFar[valuesSoFar.length - 1] as YaoValue | undefined
  const done = throws.length >= 6

  // Push the final sextet into the session as soon as the 6th throw lands so
  // /reading and /sign can rely on yaoValues being set.
  useEffect(() => {
    if (throws.length === 6) {
      setYaoValues(throws.map((t) => t.value) as unknown as YaoSextet)
    }
  }, [throws, setYaoValues])

  const doThrow = () => {
    if (done) {
      navigate('/reading')
      return
    }
    const next = castThrow()
    setFlipping(true)
    window.setTimeout(() => {
      setSides(next.sides)
      setFlipping(false)
      setThrows((prev) => (prev.length >= 6 ? prev : [...prev, next]))
    }, FLIP_MS)
  }

  const reset = () => {
    setThrows([])
    setSides(['heads', 'heads', 'tails'])
    setFlipping(false)
  }

  // Reveal-panel derivations — meaningful only once all six throws landed.
  const castValues = done ? (valuesSoFar as unknown as YaoSextet) : null
  const [benNumber, benName] = castValues ? hexagramFromBinary(castValues) : [0, '']
  const variantValues = castValues ? (changedValues(castValues) as unknown as YaoSextet) : null
  const [bianNumber, bianName] = variantValues ? hexagramFromBinary(variantValues) : [0, '']
  const benEntry = castValues ? hexagramByNumber(benNumber) : undefined
  const benJudgment = benEntry?.judgment.classical
  const changingNames = castValues
    ? changingLines(castValues).map(
        (idx) => benEntry?.lines.find((line) => line.position === idx + 1)?.name ?? ''
      )
    : []
  const changingLabel =
    changingNames.length === 6
      ? benEntry?.extra_line
        ? `六爻皆变 · 读${benEntry.extra_line.label}`
        : '六爻皆变'
      : changingNames.length > 0
        ? `变爻在${changingNames.join('、')}`
        : '无变爻'

  // Progress index for the run-header step pill — current throw is N+1
  // until done.
  const stepIndex = done ? 6 : Math.min(throws.length + 1, 6)

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
      : throws.length === 0
        ? '投币 →'
        : `投第 ${throws.length + 1} 爻 →`

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
          <div className={styles.metaSub}>投币 · 第 2 步 · 三枚硬币</div>
        </div>
      </header>

      <section className={styles.cast}>
        {/* 6-segment progress bar */}
        <div className={styles.prog}>
          {Array.from({ length: 6 }).map((_, i) => {
            const cls = [
              styles.seg,
              i < throws.length && styles.segDone,
              i === throws.length && !done && styles.segActive,
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
        {!castValues || !variantValues ? (
          <div className={styles.result}>{resultPill}</div>
        ) : (
          <div className={styles.reveal}>
            <div className={styles.revealHexRow}>
              <Hexagram values={castValues} size={88} lineH={11} gap={5} />
              <div className={styles.revealArrow}>→</div>
              <Hexagram values={variantValues} size={88} lineH={11} gap={5} />
            </div>
            <div className={styles.revealName}>
              <span className={styles.revealNameBen}>{benName}</span>
              <span className={styles.revealNameArrow}>→</span>
              <span className={styles.revealNameBian}>{bianName}</span>
            </div>
            <div className={styles.revealMeta}>
              本卦 #{benNumber} · 变卦 #{bianNumber} · {changingLabel}
            </div>
            {benJudgment && <div className={styles.revealJudgment}>「{benJudgment}」</div>}
          </div>
        )}

        {/* hex-building sidebar (only while building, not on reveal) */}
        {!done && (
          <div className={styles.hexCard}>
            <div className={styles.hexHead}>
              <span className={styles.hexLabel}>本卦 · 构建中</span>
              <span className={styles.hexCount}>{throws.length} / 6 爻</span>
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
              {/* Re-key on throw count so `drawn-grow` replays each throw. */}
              <div key={throws.length} className={styles.hexAnim}>
                <Hexagram
                  values={pad(valuesSoFar)}
                  drawn={throws.length}
                  size={108}
                  lineH={12}
                  gap={6}
                />
              </div>
            </div>
          </div>
        )}

        {/* CTA row — the ghost button discards the current throws and starts a
            fresh random cast. */}
        <div className={styles.cta}>
          <Button variant="ghost" onClick={reset} className={styles.ctaFull}>
            重新起卦
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
