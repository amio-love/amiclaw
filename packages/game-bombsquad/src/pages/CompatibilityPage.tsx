import { Link } from 'react-router-dom'
import { AI_TOOLS as AI_TOOL_NAMES } from '@amiclaw/ui'
import styles from './CompatibilityPage.module.css'

type Verification = 'verified' | 'untested'

interface AiTool {
  name: string
  verification: Verification
  statusLabel: string
  tip: string
}

/* Per-tool verification status + presentation copy, keyed by the canonical
   AI-tool name. The set and its render order come from the shared `AI_TOOLS`
   source (imported as `AI_TOOL_NAMES`); this map supplies only the data
   specific to each tool. */
const TOOL_DETAILS: Record<string, Omit<AiTool, 'name'>> = {
  Claude: {
    verification: 'verified',
    statusLabel: '已验证 ✓',
    tip: '目前唯一通过完整 acceptance 验证的 voice AI（练习 + 每日挑战 4 模块均通关）。',
  },
  ChatGPT: {
    verification: 'untested',
    statusLabel: '未测试 · 邀请反馈',
    tip: 'advanced voice mode 应可工作；玩通后请把成绩发给作者帮忙打勾。',
  },
  Gemini: {
    verification: 'untested',
    statusLabel: '未测试 · 邀请反馈',
    tip: 'Live API / 实时语音应可工作；玩通后请把成绩发给作者帮忙打勾。',
  },
}

const AI_TOOLS: AiTool[] = AI_TOOL_NAMES.map((name) => ({ name, ...TOOL_DETAILS[name] }))

export default function CompatibilityPage() {
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

      <Link to="/bombsquad" className={styles.homeLink}>
        ← 返回 BombSquad 首页
      </Link>
    </main>
  )
}
