import { Navigate, useNavigate } from 'react-router-dom'
import { BackLink, Button } from '@amiclaw/ui'
import { Hexagram } from '../glyphs'
import { changedValues, changingLines, hexagramFromBinary, type YaoSextet } from '../glyphs/utils'
import { hexagramByNumber, type HexagramLine } from '../manual'
import { useSession } from '../session'
import styles from './PageReading.module.css'

/* PageReading — 解卦: staged reveal of the classical reading.

   Honest by construction: every text on this screen is manual data for the
   cast hexagrams (classical originals + their modern glosses). There is no
   AI, no voice, no guessed "mind reading" and no fabricated dialogue — the
   former cold-reading phase machine is repurposed as a paced reveal:

     stage 0  — 本卦 卦辞 + 卦象               (继续 → reveals more)
     stage 1  — + 变爻 爻辞                     (继续 → reveals more)
     stage 2  — + 变卦 卦辞, CTA → 生成今日卦签

   Casts without changing lines skip stage 1 (no 变爻 to read). Direct
   navigation without a cast redirects home — there is no demo fallback:
   a reading only exists for a cast the visitor actually made. */

export function PageReading() {
  const { stage, setStage, yaoValues } = useSession()
  const navigate = useNavigate()

  if (yaoValues === null) return <Navigate to="/home" replace />

  const benValues: YaoSextet = yaoValues
  const bianValues = changedValues(benValues) as unknown as YaoSextet
  const [benNumber, benName] = hexagramFromBinary(benValues)
  const [bianNumber, bianName] = hexagramFromBinary(bianValues)

  const benEntry = hexagramByNumber(benNumber)
  const bianEntry = hexagramByNumber(bianNumber)
  const changing = changingLines(benValues)
  // Canonical rule: an all-six-changing cast in 乾/坤 reads 用九/用六 in place
  // of the six individual 爻辞.
  const extraLine = changing.length === 6 ? benEntry?.extra_line : undefined
  const changingEntries: HexagramLine[] =
    benEntry && !extraLine
      ? changing
          .map((idx) => benEntry.lines.find((line) => line.position === idx + 1))
          .filter((line): line is HexagramLine => line !== undefined)
      : []

  const done = stage >= 2
  const advance = () => {
    // Skip the 变爻 stage when the cast has no changing-line text to read.
    if (stage === 0) setStage(changingEntries.length > 0 || extraLine ? 1 : 2)
    else if (stage === 1) setStage(2)
  }

  return (
    <main className={styles.page}>
      <header className={styles.runHeader}>
        <BackLink variant="icon" label="返回 起卦" to="/casting" />
        <div className={styles.title}>解卦</div>
        <div className={styles.meta}>
          <div className={styles.metaLead}>第 3 步 / 3</div>
          <div className={styles.metaSub}>经典卦辞</div>
        </div>
      </header>

      <section className={styles.read}>
        {/* hex pair */}
        <div className={styles.hexes}>
          <div className={styles.hexCol}>
            <span className={styles.hexRole}>本卦</span>
            <Hexagram values={benValues} size={70} lineH={9} gap={4} />
            <span className={`${styles.hexName} ${styles.hexNameBen}`}>{benName}</span>
          </div>
          <span className={styles.hexArrow}>→</span>
          <div className={styles.hexCol}>
            <span className={styles.hexRole}>变卦</span>
            <Hexagram values={bianValues} size={70} lineH={9} gap={4} />
            <span className={`${styles.hexName} ${styles.hexNameBian}`}>{bianName}</span>
          </div>
        </div>

        {/* reading stream — classical originals + modern glosses, staged */}
        <div className={styles.stream}>
          {benEntry ? (
            <>
              <div className={`${styles.block} ${styles.blockQuote}`}>
                <div className={`${styles.blockLabel} ${styles.labelQuote}`}>本卦 · 卦辞</div>
                <div className={`${styles.blockBody} ${styles.bodyClassical}`}>
                  {benEntry.judgment.classical}
                </div>
                <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                  {benEntry.judgment.modern_interpretation}
                </div>
              </div>

              <div className={`${styles.block} ${styles.blockQuote}`}>
                <div className={`${styles.blockLabel} ${styles.labelQuote}`}>本卦 · 卦象</div>
                <div className={`${styles.blockBody} ${styles.bodyClassical}`}>
                  {benEntry.image.classical}
                </div>
                <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                  {benEntry.image.modern_interpretation}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.block}>
              <div className={`${styles.blockLabel} ${styles.labelQuote}`}>本卦 · 卦辞</div>
              <div className={styles.blockBody}>
                本卦 {benName}（第 {benNumber} 卦）的卦辞文本暂未收录。
              </div>
            </div>
          )}

          {/* stage ≥ 1 — changing-line texts (用九/用六 replaces all six 爻辞
              on an all-six-changing 乾/坤 cast) */}
          {stage >= 1 && extraLine && (
            <div className={`${styles.block} ${styles.blockQuote}`}>
              <div className={`${styles.blockLabel} ${styles.labelQuote}`}>
                变爻 · {extraLine.label}
              </div>
              <div className={`${styles.blockBody} ${styles.bodyClassical}`}>
                {extraLine.classical}
              </div>
              <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                {extraLine.modern_interpretation}
              </div>
              <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                {extraLine.changing_guidance}
              </div>
            </div>
          )}
          {stage >= 1 &&
            changingEntries.map((line) => (
              <div key={line.position} className={`${styles.block} ${styles.blockQuote}`}>
                <div className={`${styles.blockLabel} ${styles.labelQuote}`}>
                  变爻 · {line.name}
                </div>
                <div className={`${styles.blockBody} ${styles.bodyClassical}`}>
                  {line.classical}
                </div>
                <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                  {line.modern_interpretation}
                </div>
                <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                  {line.changing_guidance}
                </div>
              </div>
            ))}

          {/* stage ≥ 2 — 变卦 judgment closes the reading */}
          {stage >= 2 &&
            (bianEntry ? (
              <div className={`${styles.block} ${styles.blockQuote}`}>
                <div className={`${styles.blockLabel} ${styles.labelQuote}`}>变卦 · 卦辞</div>
                <div className={`${styles.blockBody} ${styles.bodyClassical}`}>
                  {bianEntry.judgment.classical}
                </div>
                <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                  {bianEntry.judgment.modern_interpretation}
                </div>
              </div>
            ) : (
              <div className={styles.block}>
                <div className={`${styles.blockLabel} ${styles.labelQuote}`}>变卦 · 卦辞</div>
                <div className={styles.blockBody}>
                  变卦 {bianName}（第 {bianNumber} 卦）的卦辞文本暂未收录。
                </div>
              </div>
            ))}
        </div>

        <div className={styles.cta}>
          {done ? (
            <Button variant="primary" onClick={() => navigate('/sign')} className={styles.ctaFull}>
              生成今日卦签 →
            </Button>
          ) : (
            <Button variant="primary" onClick={advance} className={styles.ctaFull}>
              继续 · 往下读 →
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/home')} className={styles.ctaFull}>
            退出
          </Button>
        </div>
      </section>
    </main>
  )
}
