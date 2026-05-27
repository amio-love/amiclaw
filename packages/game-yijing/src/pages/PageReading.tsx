import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@amiclaw/ui'
import { Hexagram } from '../glyphs'
import { changedValues, hexagramFromBinary, type YaoSextet } from '../glyphs/utils'
import { useSession } from '../session'
import styles from './PageReading.module.css'

/* PageReading — handoff §6.4 读心·解读.

   Cold-reading three-phase state machine:
     phase 0  — AI 念卦辞 + 初次推测              (confirm-row visible)
     phase 1  — 玩家选「✗ 不太对」，补充语音回应  (confirm-row visible)
     phase 2  — AI 调整 + 念变爻 + 综合洞见        (confirm-row hidden,
                  CTA → 生成今日卦签)

   Edge case (happy path): clicking ✓ 差不多 at phase 0 jumps to phase 2
   directly — the user-block is NOT appended because there was no
   correction. A local `corrected` flag captures whether the user passed
   through phase 1 (the only situation that surfaces the user-block). */

const VOICE_TOGGLE_MS = 3500

// Fallback sextet for direct /reading navigation when the session has no
// cast result yet. Matches PageCasting's DEMO_VALUES (天火同人 → 天雷无妄).
const DEMO_FALLBACK: YaoSextet = [7, 8, 9, 7, 7, 7]

const BAR_COUNT = 14
const BAR_STAGGER_S = 0.07

export function PageReading() {
  const { phase, setPhase, voiceState, setVoiceState, yaoValues } = useSession()
  const navigate = useNavigate()
  const [corrected, setCorrected] = useState(false)

  // Voice toggle every 3.5s for visual life. `setVoiceState` is referentially
  // stable via SessionProvider's useCallback, so it does not retrigger.
  useEffect(() => {
    // Kick off in `speaking` so phase-0 stream looks active even on direct nav.
    if (voiceState === 'idle') setVoiceState('speaking')
    const timer = window.setInterval(() => {
      setVoiceState(voiceState === 'speaking' ? 'listening' : 'speaking')
    }, VOICE_TOGGLE_MS)
    return () => window.clearInterval(timer)
  }, [voiceState, setVoiceState])

  const benValues: YaoSextet = yaoValues ?? DEMO_FALLBACK
  const bianValues = changedValues(benValues) as unknown as YaoSextet
  const [, benName] = hexagramFromBinary(benValues)
  const [, bianName] = hexagramFromBinary(bianValues)

  const speaking = voiceState === 'speaking'

  // Happy-path: ✓ at phase 0 jumps straight to phase 2 with no user-block.
  // Correction path: ✗ at phase 0 → phase 1 (records correction); ✓ at
  // phase 1 → phase 2 (user-block stays in the stream).
  const onYes = () => {
    if (phase === 0) {
      setPhase(2)
    } else if (phase === 1) {
      setPhase(2)
    }
  }
  const onNo = () => {
    if (phase < 2) {
      setCorrected(true)
      setPhase(1)
    }
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
        <div className={styles.title}>读心</div>
        <div className={styles.meta}>
          <div className={styles.metaLead}>第 3 步 / 3</div>
          <div className={styles.metaSub}>语音对话中</div>
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

        {/* voice indicator */}
        <div className={styles.voice}>
          <div className={styles.voiceAvatar}>
            <div className={styles.voiceAvatarInner}>AI</div>
          </div>
          <div>
            <div className={styles.voiceBars}>
              {Array.from({ length: BAR_COUNT }).map((_, i) => {
                const barCls = [styles.voiceBar, !speaking && styles.voiceBarPaused]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <span
                    key={i}
                    className={barCls}
                    style={{ animationDelay: `${i * BAR_STAGGER_S}s` }}
                  />
                )
              })}
            </div>
          </div>
          <div className={styles.voiceState}>
            {speaking ? '正在说话' : '听你说'}
            <div className={styles.voiceSub}>{speaking ? 'Claude · 中文' : '随时打断'}</div>
          </div>
        </div>

        {/* confirm row — visible only while still in cold-reading */}
        {phase < 2 && (
          <div className={styles.confirm}>
            <button type="button" className={styles.confirmNo} onClick={onNo}>
              <span style={{ fontSize: 14 }}>✗</span> 不太对
            </button>
            <button type="button" className={styles.confirmYes} onClick={onYes}>
              <span style={{ fontSize: 14 }}>✓</span> 差不多
            </button>
          </div>
        )}

        {/* reading stream */}
        <div className={styles.stream}>
          {/* phase ≥ 0 — always */}
          <div className={`${styles.block} ${styles.blockQuote}`}>
            <div className={`${styles.blockLabel} ${styles.labelQuote}`}>本卦 · 卦辞</div>
            <div className={`${styles.blockBody} ${styles.bodyClassical}`}>
              同人于野，亨。利涉大川，利君子贞。
            </div>
          </div>

          <div className={`${styles.block} ${styles.blockGuess}`}>
            <div className={`${styles.blockLabel} ${styles.labelGuess}`}>AI · 推测</div>
            <div className={styles.blockBody}>
              根据你的卦象和你刚才的选择，我有一个感觉……你最近在思考一段
              <span className={styles.accent}>合作关系</span>里的某个
              <span className={styles.accent}>转折</span>。可能是一个你曾经觉得
              「该一起努力」的人，你们之间正在悄悄发生变化。
            </div>
          </div>

          {/* phase ≥ 1 AND corrected — user-block from the ✗ path only */}
          {phase >= 1 && corrected && (
            <div className={`${styles.block} ${styles.blockUser}`}>
              <div className={`${styles.blockLabel} ${styles.labelUser}`}>你 · 语音</div>
              <div className={styles.blockBody}>「不是关系本身，而是『要不要继续往前走』。」</div>
            </div>
          )}

          {/* phase ≥ 2 — adjusted guess + 变爻 quote + 综合洞见 */}
          {phase >= 2 && (
            <>
              <div className={`${styles.block} ${styles.blockGuess}`}>
                <div className={`${styles.blockLabel} ${styles.labelGuess}`}>AI · 调整后</div>
                <div className={styles.blockBody}>
                  原来如此，那换个角度看这一卦——你抽到的
                  <span className={styles.accent}>同人</span>
                  ，下卦是离（火），上卦是乾（天），火往上烧、天在更高处。
                  这是一卦讲「同行人能走多远」的卦。
                </div>
              </div>

              <div className={`${styles.block} ${styles.blockQuote}`}>
                <div className={`${styles.blockLabel} ${styles.labelQuote}`}>变爻 · 九三</div>
                <div className={`${styles.blockBody} ${styles.bodyClassical}`}>
                  伏戎于莽，升其高陵，三岁不兴。
                </div>
                <div className={`${styles.blockBody} ${styles.bodyGloss}`}>
                  ——把兵藏进草丛，登上高陵远望。三年都不轻举妄动。
                </div>
              </div>

              <div className={styles.block}>
                <div className={`${styles.blockLabel} ${styles.labelAi}`}>AI · 综合洞见</div>
                <div className={styles.blockBody}>
                  同人之道在野不在朋党。九三的潜伏与不兴，是要你把脚步先停下来，
                  听清自己更想要什么——
                  <span className={styles.accent}>主动停一停</span>
                  不是放弃，是让真正的同行人显形。
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.cta}>
          {phase >= 2 ? (
            <Button variant="primary" onClick={() => navigate('/sign')} className={styles.ctaFull}>
              生成今日卦签 →
            </Button>
          ) : (
            <button type="button" className={styles.textLink}>
              ⓘ AI 还在和你对话 —— 听完再确认
            </button>
          )}
          <Button variant="ghost" onClick={() => navigate('/home')} className={styles.ctaFull}>
            退出
          </Button>
        </div>
      </section>
    </main>
  )
}
