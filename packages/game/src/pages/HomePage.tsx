import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDailyChallenge } from '@/hooks/useDailyChallenge'
import { copyToClipboard } from '@/utils/clipboard'
import styles from './HomePage.module.css'

const HOW_TO_STEPS = [
  'Open your AI (Claude, ChatGPT, Gemini…) in voice mode on another device or tab.',
  'Copy the prompt below and send it to your AI. Wait for it to confirm it has read the manual.',
  'Click Practice or Daily Challenge, then hit Start when your AI is ready.',
  'Describe what you see — your AI will guide you. Shorter time = higher rank.',
]

export default function HomePage() {
  const navigate = useNavigate()
  const { practiceUrl, dailyUrl } = useDailyChallenge()
  const [copied, setCopied] = useState(false)

  const promptText = `You are a bomb disposal expert. Your partner is facing a bomb and needs your guidance.

The operations manual is here: ${practiceUrl}

Please read the complete manual first, then tell your partner you are ready.

Rules:
- They will describe what they see via voice
- You find the matching rules and tell them what to do
- Shorter time = higher global rank
- Ask about the Scene Info bar (serial number, battery count, indicator lights) — many rules depend on these
- Give concise instructions; ask follow-up questions if unsure`

  const handleCopy = async () => {
    const ok = await copyToClipboard(promptText)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>BOMBSQUAD</h1>
      <p className={styles.subtitle}>Human + AI · Voice-based bomb defusal</p>

      <div className={styles.ctaRow}>
        <button
          className={styles.btnSecondary}
          onClick={() => navigate('/game?mode=practice')}
        >
          PRACTICE
        </button>
        <button
          className={styles.btnPrimary}
          onClick={() => navigate(`/game?mode=daily&url=${encodeURIComponent(dailyUrl)}`)}
        >
          DAILY CHALLENGE
        </button>
      </div>

      <Link to="/leaderboard" className={styles.leaderboardLink}>
        Leaderboard →
      </Link>

      <section className={styles.howTo} aria-label="How to start">
        <h2 className={styles.howToTitle}>How to Start</h2>
        <ol className={styles.howToList}>
          {HOW_TO_STEPS.map((step, i) => (
            <li key={i}>
              <span className={styles.stepNum}>{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.promptSection} aria-label="AI prompt">
        <div className={styles.promptLabel}>Copy this prompt for your AI</div>
        <div className={styles.promptBox}>
          <pre className={styles.promptText}>{promptText}</pre>
          <button
            className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
            onClick={handleCopy}
            aria-label="Copy prompt to clipboard"
          >
            {copied ? 'COPIED!' : 'COPY'}
          </button>
        </div>
      </section>

      <p className={styles.footer}>Works with Claude · ChatGPT · Gemini · any voice AI</p>
    </main>
  )
}
