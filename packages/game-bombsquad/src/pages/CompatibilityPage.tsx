import { useState } from 'react'
import { Link } from 'react-router-dom'
import { copyToClipboard } from '@/utils/clipboard'
import { OPENING_PROMPT } from '@/constants/opening-prompt'
import styles from './CompatibilityPage.module.css'

type Verification = 'verified' | 'untested'

interface AiTool {
  name: string
  verification: Verification
  statusLabel: string
  tip: string
}

const AI_TOOLS: AiTool[] = [
  {
    name: 'Claude',
    verification: 'verified',
    statusLabel: '已验证 ✓',
    tip: '目前唯一通过完整 acceptance 验证的 voice AI（练习 + 每日挑战 4 模块均通关）。',
  },
  {
    name: 'ChatGPT',
    verification: 'untested',
    statusLabel: '未测试 · 邀请反馈',
    tip: 'advanced voice mode 应可工作；玩通后请把成绩发给作者帮忙打勾。',
  },
  {
    name: 'Gemini',
    verification: 'untested',
    statusLabel: '未测试 · 邀请反馈',
    tip: 'Live API / 实时语音应可工作；玩通后请把成绩发给作者帮忙打勾。',
  },
]

export default function CompatibilityPage() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const ok = await copyToClipboard(OPENING_PROMPT)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>支持的 AI 工具</h1>
        <p className={styles.subtitle}>
          BombSquad 不集成任何 AI 接口，你可以选择任意支持语音对话的 AI 与你协作。
        </p>
      </header>

      <section className={styles.toolsSection} aria-label="已验证的 AI 工具">
        <ul className={styles.toolList}>
          {AI_TOOLS.map((tool) => (
            <li
              key={tool.name}
              className={
                tool.verification === 'verified'
                  ? `${styles.toolCard} ${styles.toolCardVerified}`
                  : styles.toolCard
              }
            >
              <div className={styles.toolHeader}>
                <span className={styles.toolName}>{tool.name}</span>
                <span
                  className={
                    tool.verification === 'verified'
                      ? `${styles.statusBadge} ${styles.statusVerified}`
                      : `${styles.statusBadge} ${styles.statusUntested}`
                  }
                >
                  {tool.statusLabel}
                </span>
              </div>
              <p className={styles.toolTip}>{tool.tip}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.promptSection} aria-label="推荐开场白">
        <h2 className={styles.promptTitle}>告诉 AI 该怎么做</h2>
        <p className={styles.promptIntro}>把下面这段话先念给你的 AI 听，再把手册地址发过去。</p>
        <div className={styles.promptBox}>
          <pre className={styles.promptText}>{OPENING_PROMPT}</pre>
          <button
            type="button"
            className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
            onClick={handleCopy}
            aria-label="复制推荐开场白到剪贴板"
          >
            {copied ? '已复制！' : '复制开场白'}
          </button>
        </div>
      </section>

      <Link to="/bombsquad" className={styles.homeLink}>
        ← 返回 BombSquad 首页
      </Link>
    </main>
  )
}
