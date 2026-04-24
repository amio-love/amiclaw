import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDailyChallenge } from '@/hooks/useDailyChallenge'
import { copyToClipboard } from '@/utils/clipboard'
import { buildAssistantPrompt, type PromptMode } from '@/utils/assistant-prompt'
import styles from './HomePage.module.css'

const HOW_TO_STEPS = [
  '在另一个窗口/设备打开你的 AI（Claude、ChatGPT、Gemini…）并切到语音模式。',
  '选「练习 Prompt」或「每日 Prompt」，复制后发给 AI。等它说读完手册了。',
  'AI 就位后，点「练习」或「每日挑战」，然后按「开始」。',
  '描述你看到的场景，AI 会告诉你怎么操作。用时越短，排名越高。',
]

export default function HomePage() {
  const navigate = useNavigate()
  const { practiceUrl, dailyUrl } = useDailyChallenge()
  const [copied, setCopied] = useState(false)
  const [promptMode, setPromptMode] = useState<PromptMode>('daily')

  const manualUrl = promptMode === 'daily' ? dailyUrl : practiceUrl
  const promptText = buildAssistantPrompt({ mode: promptMode, manualUrl })

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
      <p className={styles.subtitle}>人机协作 · 语音拆弹挑战</p>

      <div className={styles.ctaRow}>
        <button className={styles.btnSecondary} onClick={() => navigate('/game?mode=practice')}>
          练习
        </button>
        <button
          className={styles.btnPrimary}
          onClick={() => navigate(`/game?mode=daily&url=${encodeURIComponent(dailyUrl)}`)}
        >
          每日挑战
        </button>
      </div>

      <Link to="/leaderboard" className={styles.leaderboardLink}>
        排行榜 →
      </Link>

      <section className={styles.howTo} aria-label="怎么开始">
        <h2 className={styles.howToTitle}>怎么开始</h2>
        <ol className={styles.howToList}>
          {HOW_TO_STEPS.map((step, i) => (
            <li key={i}>
              <span className={styles.stepNum}>{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.promptSection} aria-label="AI Prompt">
        <div className={styles.promptLabel}>复制这段 Prompt 给你的 AI</div>
        <div className={styles.promptModeRow} role="group" aria-label="Prompt 模式">
          <button
            type="button"
            className={`${styles.promptModeBtn} ${promptMode === 'practice' ? styles.promptModeActive : ''}`}
            onClick={() => setPromptMode('practice')}
            aria-pressed={promptMode === 'practice'}
          >
            练习 Prompt
          </button>
          <button
            type="button"
            className={`${styles.promptModeBtn} ${promptMode === 'daily' ? styles.promptModeActive : ''}`}
            onClick={() => setPromptMode('daily')}
            aria-pressed={promptMode === 'daily'}
          >
            每日 Prompt
          </button>
        </div>
        <div className={styles.promptBox}>
          <pre className={styles.promptText}>{promptText}</pre>
          <button
            className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
            onClick={handleCopy}
            aria-label="复制 Prompt 到剪贴板"
          >
            {copied ? '已复制！' : '复制'}
          </button>
        </div>
      </section>

      <p className={styles.footer}>支持 Claude · ChatGPT · Gemini 或任意语音 AI</p>
    </main>
  )
}
