import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDailyChallenge } from '@/hooks/useDailyChallenge'
import PromptModal, { type PromptMode } from '@/components/PromptModal'
import styles from './HomePage.module.css'

const HOW_TO_STEPS = [
  '点「练习」或「每日挑战」，复制弹窗里的手册链接。',
  '打开 AI 并切到语音模式，把链接发给它，等它读完手册。',
  '回游戏页，按「确认开始游戏」。',
  '描述你看到的场景，照 AI 指引操作 —— 用时越短，排名越高。',
]

interface ModalState {
  mode: PromptMode
  manualUrl: string
  onConfirmNavigate: () => void
}

export default function HomePage() {
  const navigate = useNavigate()
  const { practiceUrl, dailyUrl } = useDailyChallenge()
  const [modal, setModal] = useState<ModalState | null>(null)

  const openPractice = () =>
    setModal({
      mode: 'practice',
      manualUrl: practiceUrl,
      onConfirmNavigate: () => navigate('/game?mode=practice'),
    })

  const openDaily = () =>
    setModal({
      mode: 'daily',
      manualUrl: dailyUrl,
      onConfirmNavigate: () => navigate(`/game?mode=daily&url=${encodeURIComponent(dailyUrl)}`),
    })

  const closeModal = () => setModal(null)

  const confirmModal = () => {
    const navigateToGame = modal?.onConfirmNavigate
    setModal(null)
    navigateToGame?.()
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>BOMBSQUAD</h1>
      <p className={styles.subtitle}>人机协作 · 语音拆弹挑战</p>

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

      <div className={styles.ctaRow}>
        <button className={styles.btnSecondary} onClick={openPractice}>
          练习
        </button>
        <button className={styles.btnPrimary} onClick={openDaily}>
          每日挑战
        </button>
      </div>

      <Link to="/leaderboard" className={styles.leaderboardLink}>
        排行榜 →
      </Link>

      <p className={styles.footer}>支持 Claude · ChatGPT · Gemini 或任意语音 AI</p>

      <PromptModal
        key={modal?.manualUrl}
        open={modal !== null}
        mode={modal?.mode ?? 'practice'}
        manualUrl={modal?.manualUrl ?? ''}
        onConfirm={confirmModal}
        onClose={closeModal}
      />
    </main>
  )
}
