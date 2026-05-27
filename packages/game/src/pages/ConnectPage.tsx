import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Scenery, ConicAvatar } from '@amiclaw/ui'
import Eyebrow from '@/components/bombsquad/Eyebrow'
import Button from '@/components/bombsquad/Button'
import { useDailyChallenge } from '@/hooks/useDailyChallenge'
import { copyToClipboard } from '@/utils/clipboard'
import styles from './ConnectPage.module.css'

type ConnectMode = 'daily' | 'practice'

/* Connect-AI flow — design_handoff_bombsquad README §6.2. Three steps
   swap in place: copy the manual link, switch the AI to voice mode, then
   confirm and hand off to the existing run. The manual URL is derived by
   useDailyChallenge and copied with copyToClipboard, no parallel
   mechanism. */
export default function ConnectPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode: ConnectMode = searchParams.get('mode') === 'practice' ? 'practice' : 'daily'
  const modeLabel = mode === 'daily' ? '每日挑战' : '练习'

  const { dailyUrl, practiceUrl } = useDailyChallenge()
  const manualUrl = mode === 'daily' ? dailyUrl : practiceUrl

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [copied, setCopied] = useState(false)

  /* Once the manual link is copied, the card turns green and the flow
     auto-advances to step 2 after ~0.7s. The timer is owned by an effect
     so it cleans up if the player leaves the page mid-wait. */
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setStep(2), 700)
    return () => clearTimeout(id)
  }, [copied])

  const handleCopy = async () => {
    if (copied) return
    const ok = await copyToClipboard(manualUrl)
    if (ok) setCopied(true)
  }

  /* Step 3 → the existing run. Daily carries the manual URL as ?url= so
     the AI partner and the run fetch the same manual; practice loads its
     bundled manual and needs no URL. */
  const confirmStart = () => {
    if (mode === 'daily') {
      navigate(`/game/run?mode=daily&url=${encodeURIComponent(dailyUrl)}`)
    } else {
      navigate('/game/run?mode=practice')
    }
  }

  // SVG thread between the player and the AI: a faint guide path plus a
  // yellow path that draws itself in as the steps progress.
  const threadOffset = step === 3 ? 0 : 200 - step * 80

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />
      <div className={styles.stage}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate('/game')}
            aria-label="返回 BombSquad 主页"
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
          <div className={styles.headerMeta}>
            <div className={styles.headerMode}>{modeLabel}</div>
            <div className={styles.headerSub}>对接 AI</div>
          </div>
          <span className={styles.headerSpacer} aria-hidden="true" />
        </header>

        <div className={styles.connect}>
          <Eyebrow dot color="var(--y)">
            第 {step}/3 步
          </Eyebrow>

          <h2 className={styles.title}>
            {step === 1 && (
              <>
                把<span className={styles.titleAccent}>手册</span>发给 AI。
              </>
            )}
            {step === 2 && (
              <>
                切到<span className={styles.titleAccent}>语音模式</span>。
              </>
            )}
            {step === 3 && (
              <>
                深呼吸 —— <span className={styles.titleAccent}>准备开局</span>。
              </>
            )}
          </h2>

          {/* Player ↔ AI connection visualization. */}
          <div className={styles.vis}>
            <div className={styles.visSide}>
              <ConicAvatar size={64} letter="你" ariaHidden />
              <div className={styles.visLabel}>你</div>
            </div>
            <div className={styles.thread} aria-hidden="true">
              <svg viewBox="0 0 200 80" preserveAspectRatio="none">
                <path
                  d="M 5 40 Q 100 5 195 40"
                  stroke="rgba(255,229,62,.35)"
                  strokeWidth="1.5"
                  fill="none"
                  strokeDasharray={step === 3 ? '0' : '4 4'}
                />
                <path
                  className={styles.threadDraw}
                  d="M 5 40 Q 100 5 195 40"
                  stroke="var(--y)"
                  strokeWidth="1.5"
                  fill="none"
                  strokeDasharray="200"
                  style={{ strokeDashoffset: threadOffset }}
                />
              </svg>
              {step === 3 && <div className={styles.spark}>✦</div>}
            </div>
            <div className={styles.visSide}>
              <div className={styles.aiAvatar}>
                <ConicAvatar size={64} letter="AI" ariaHidden />
                <span className={styles.aiPulse} />
              </div>
              <div className={styles.visLabel}>Claude</div>
            </div>
          </div>

          {/* Step 1 — copy the manual link. */}
          {step === 1 && (
            <div className={styles.action}>
              <button
                type="button"
                className={`${styles.copyCard} ${copied ? styles.copyCardDone : ''}`}
                onClick={handleCopy}
              >
                <div className={styles.copyCardText}>
                  <div className={styles.copyCardLabel}>
                    {copied ? '已复制到剪贴板' : '手册链接'}
                  </div>
                  <div className={styles.copyCardUrl}>{manualUrl}</div>
                </div>
                <div className={styles.copyCardIcon}>
                  {copied ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M5 12 L10 17 L19 7" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    >
                      <rect x="8" y="8" width="12" height="12" rx="2" />
                      <path d="M16 8 V5 a2 2 0 0 0 -2 -2 H6 a2 2 0 0 0 -2 2 v9 a2 2 0 0 0 2 2 h3" />
                    </svg>
                  )}
                </div>
              </button>
              <p className={styles.hint}>粘贴到你常用的 AI，让它读完手册后说「好了」。</p>
              {/* /compatibility discovery link — re-homed here from the
                 retired PromptModal, which placed it directly under the
                 same send-to-AI content. Step 1 is that moment now. */}
              <Link to="/compatibility" className={styles.compatLink}>
                不确定用哪个 AI？查看支持工具 →
              </Link>
            </div>
          )}

          {/* Step 2 — switch the AI partner into voice mode. */}
          {step === 2 && (
            <div className={styles.action}>
              <button type="button" className={styles.copyCard} onClick={() => setStep(3)}>
                <div className={styles.copyCardText}>
                  <div className={styles.copyCardLabel}>切到语音模式</div>
                  <div className={styles.copyCardUrl}>AI 端 → 麦克风</div>
                </div>
                <div className={styles.copyCardIcon}>
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <rect x="9" y="3" width="6" height="12" rx="3" />
                    <path d="M5 11 a7 7 0 0 0 14 0 M12 18 V21 M9 21 H15" />
                  </svg>
                </div>
              </button>
              <p className={styles.hint}>这样你描述、AI 回应，全程不用手离开屏幕。</p>
            </div>
          )}

          {/* Step 3 — ready pulse, then confirm. */}
          {step === 3 && (
            <div className={styles.action}>
              <div className={styles.readyPulse} aria-hidden="true">
                <div className={styles.readyRing} />
                <div className={styles.readyRing} />
                <div className={styles.readyRing} />
                <div className={styles.readyCore} />
              </div>
              <p className={`${styles.hint} ${styles.hintCenter}`}>AI 已读完手册，正在等你。</p>
            </div>
          )}

          <div className={styles.cta}>
            {step < 3 ? (
              <Button
                variant="primary"
                full
                disabled={step === 1 && !copied}
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              >
                {step === 1 ? (copied ? '下一步 →' : '先复制手册') : '下一步 →'}
              </Button>
            ) : (
              <Button variant="primary" full onClick={confirmStart}>
                确认开始游戏 →
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
