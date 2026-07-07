import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@amiclaw/ui'
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

   Casts without changing lines skip stage 1 (no 变爻 to read). */

// Fallback sextet for direct /reading navigation when the session has no
// cast result yet. Matches PageCasting's DEMO_VALUES (天火同人 → 天雷无妄).
const DEMO_FALLBACK: YaoSextet = [7, 8, 9, 7, 7, 7]

export function PageReading() {
  const { stage, setStage, yaoValues } = useSession()
  const navigate = useNavigate()

  const benValues: YaoSextet = yaoValues ?? DEMO_FALLBACK
  const bianValues = changedValues(benValues) as unknown as YaoSextet
  const [benNumber, benName] = hexagramFromBinary(benValues)
  const [bianNumber, bianName] = hexagramFromBinary(bianValues)

  const benEntry = hexagramByNumber(benNumber)
  const bianEntry = hexagramByNumber(bianNumber)
  const changing = changingLines(benValues)
  const changingEntries: HexagramLine[] = benEntry
    ? changing
        .map((idx) => benEntry.lines.find((line) => line.position === idx + 1))
        .filter((line): line is HexagramLine => line !== undefined)
    : []

  const done = stage >= 2
  const advance = () => {
    // Skip the 变爻 stage when the cast has no changing lines to read.
    if (stage === 0) setStage(changingEntries.length > 0 ? 1 : 2)
    else if (stage === 1) setStage(2)
  }

  return (
    <main className={styles.page}>
      <header className={styles.runHeader}>
        <Link to="/casting" className={styles.iconBtn} aria-label="返回 起卦">
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
        <div className={styles.title}>解卦</div>
        <div className={styles.meta}>
          <div className={styles.metaLead}>第 3 步 / 3</div>
          <div className={styles.metaSub}>经典卦辞 · 卦例演示</div>
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

          {/* stage ≥ 1 — changing-line texts */}
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
