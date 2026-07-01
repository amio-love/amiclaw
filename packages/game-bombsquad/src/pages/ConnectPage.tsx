import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Scenery, ConicAvatar } from '@amiclaw/ui'
import Eyebrow from '@/components/bombsquad/Eyebrow'
import Button from '@/components/bombsquad/Button'
import { useDailyChallenge } from '@/hooks/useDailyChallenge'
import { copyToClipboard } from '@/utils/clipboard'
import { getAudioContext } from '@/audio/audio-context'
import styles from './ConnectPage.module.css'

type ConnectMode = 'daily' | 'practice'

/* Connect-AI flow — design_handoff_bombsquad README §6.2. Two steps swap in
   place: copy the manual link in one tap, then switch the AI to voice mode and
   hand off to the run. The AI-readiness sync prompt now lives here, on step 2
   (where the player is actually setting their AI up); there is no separate
   GamePage gate — "进入游戏" starts the run directly. Tapping it also unlocks
   iOS audio inside the user gesture. The manual URL is derived by
   useDailyChallenge; voice AIs auto-read a bare pasted link and adopt the role
   from the now-self-framing manual, so the link alone suffices. */
export default function ConnectPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode: ConnectMode = searchParams.get('mode') === 'practice' ? 'practice' : 'daily'
  const modeLabel = mode === 'daily' ? '每日挑战' : '练习'

  const { dailyUrl, practiceUrl } = useDailyChallenge()
  const manualUrl = mode === 'daily' ? dailyUrl : practiceUrl

  const [step, setStep] = useState<1 | 2>(1)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  /* Once the manual link is copied, the card turns green and the flow
     auto-advances to step 2 after ~0.7s. The timer is owned by an effect
     so it cleans up if the player leaves the page mid-wait. */
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setStep(2), 700)
    return () => clearTimeout(id)
  }, [copied])

  /* One tap copies the manual URL. Voice AIs auto-read a bare pasted link and
     adopt the role from the now-self-framing manual, so the link alone is
     enough — no opening prompt needed. */
  const handleCopy = async () => {
    if (copied) return
    const ok = await copyToClipboard(manualUrl)
    if (ok) {
      setCopyFailed(false)
      setCopied(true)
    } else {
      setCopyFailed(true)
    }
  }

  const continueAfterManualHandoff = () => {
    setStep(2)
  }

  /* Final step → the existing run. Daily carries the manual URL as ?url= so
     the AI partner and the run fetch the same manual; practice loads its
     bundled manual and needs no URL. This tap is the run's only gesture, so
     unlock the shared AudioContext here — iOS Safari only permits audio to
     start from inside a user gesture, and the run's stopwatch SFX loop runs
     outside one. getAudioContext() is idempotent; the run calls it again at
     game start as a fallback. */
  const confirmStart = () => {
    getAudioContext()
    if (mode === 'daily') {
      navigate(`/bombsquad/run?mode=daily&url=${encodeURIComponent(dailyUrl)}`)
    } else {
      navigate('/bombsquad/run?mode=practice')
    }
  }

  // SVG thread between the player and the AI: a faint guide path plus a
  // yellow path that draws itself in fully on the final step.
  const threadOffset = step === 2 ? 0 : 200 - step * 80

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />
      <div className={styles.stage}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate('/bombsquad')}
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
            第 {step}/2 步
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
                  strokeDasharray={step === 2 ? '0' : '4 4'}
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
              {step === 2 && <div className={styles.spark}>✦</div>}
            </div>
            <div className={styles.visSide}>
              <div className={styles.aiAvatar}>
                <ConicAvatar size={64} letter="AI" ariaHidden />
                <span className={styles.aiPulse} />
              </div>
              {/* BYO-neutral: the player supplies their own voice AI (Claude /
                  ChatGPT / Gemini / …), so this mirrors "你" rather than naming
                  one tool. */}
              <div className={styles.visLabel}>你的 AI</div>
            </div>
          </div>

          {/* Step 1 — copy the manual link. The full URL card and the bottom
              primary CTA share the same copy action: the card keeps the link
              visible and trustworthy, while the CTA remains the strongest
              explicit command for players scanning fast. */}
          {step === 1 && (
            <div className={styles.action}>
              <button
                type="button"
                className={`${styles.urlPreview} ${copied ? styles.urlPreviewDone : ''}`}
                onClick={handleCopy}
                aria-label={
                  copied ? '已复制手册链接' : copyFailed ? '重试复制手册链接' : '复制手册链接'
                }
              >
                <div className={styles.copyCardText}>
                  <div className={styles.copyCardLabel}>
                    {copied ? '已复制到剪贴板' : copyFailed ? '复制失败，链接仍可用' : '手册链接'}
                  </div>
                  <div className={styles.copyCardUrl}>{manualUrl}</div>
                </div>
                <div className={styles.copyCardIcon} aria-hidden="true">
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

              <p className={styles.hint}>
                {copyFailed
                  ? '浏览器没有允许自动复制，但上面的链接就是同一份手册。手动把它发给 AI，和复制后粘贴完全一样；等它读完后继续。'
                  : '粘贴到你常用的 AI，让它读完手册后说「好了」。'}
              </p>
              {/* /compatibility discovery link — re-homed here from the
                 retired PromptModal, which placed it directly under the
                 same send-to-AI content. Step 1 is that moment now. */}
              <Link to="/bombsquad/compatibility" className={styles.compatLink}>
                不确定用哪个 AI？查看支持工具 →
              </Link>
            </div>
          )}

          {/* Step 2 — a passive reminder of the one thing to do on the AI
              side: switch it to voice mode. Deliberately NOT a button — the
              UI cannot flip the player's AI into voice mode, so a tappable
              card here would fake an action the app does not perform. The
              only real action on this step is the 进入游戏 handoff below. */}
          {step === 2 && (
            <div className={styles.action}>
              <div className={styles.voiceStep}>
                <div className={styles.voiceStepIcon} aria-hidden="true">
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
                <div className={styles.voiceStepText}>
                  <div className={styles.voiceStepLabel}>切到语音模式</div>
                  <div className={styles.voiceStepSub}>AI 端 → 麦克风</div>
                </div>
              </div>
              <p className={styles.hint}>这样你描述、AI 回应，全程不用手离开屏幕。</p>
              {/* AI-readiness sync prompt — re-homed from the deleted GamePage
                  「开始」gate to the place the player is actually setting up
                  their AI. Anchors to step 1's canonical「让它读完手册后说
                  『好了』」wording and names the one consequence of the next
                  tap: 进入游戏 starts the run, and the stopwatch starts with
                  it. Calm, not a countdown — time is a score, not a deadline. */}
              <p className={styles.hint}>
                等 AI 说完「好了」，点「进入游戏」就开始，计时随即启动。
              </p>
            </div>
          )}

          <div className={styles.cta}>
            {step === 1 ? (
              /* The CTA mirrors the URL card's copy action: tap copies the
                 manual URL, flips to the green confirmed state, and the 0.7s
                 effect above auto-advances to step 2. No disabled / dead
                 control on this step. */
              <>
                <Button
                  variant="primary"
                  full
                  accent={copied ? 'green' : copyFailed ? 'rose' : 'yellow'}
                  onClick={handleCopy}
                >
                  {copied ? '已复制 ✓' : copyFailed ? '重试复制' : '复制手册'}
                </Button>
                {copyFailed && !copied && (
                  <Button variant="ghost" full onClick={continueAfterManualHandoff}>
                    我已手动发给 AI，继续 →
                  </Button>
                )}
              </>
            ) : (
              <Button variant="primary" full onClick={confirmStart}>
                进入游戏 →
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
