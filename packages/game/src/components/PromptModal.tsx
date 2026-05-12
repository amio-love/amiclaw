import { useEffect, useId, useState, type MouseEvent } from 'react'
import { copyToClipboard } from '@/utils/clipboard'
import styles from './PromptModal.module.css'

export type PromptMode = 'practice' | 'daily'

interface PromptModalProps {
  open: boolean
  manualUrl: string
  mode: PromptMode
  onConfirm: () => void
  onClose: () => void
}

/**
 * Pre-game gate shown after a player clicks 练习 / 每日挑战 on the home page.
 *
 * Surfaces the manual URL with a copy button so the player can hand it to
 * their AI partner before pressing 确认开始游戏. The modal copies the URL
 * only — the AI fetches the full manual itself.
 */
export default function PromptModal({
  open,
  manualUrl,
  mode,
  onConfirm,
  onClose,
}: PromptModalProps) {
  const [copied, setCopied] = useState(false)
  const titleId = useId()

  // Esc-to-close. Only bound while the modal is open so we don't intercept
  // Esc on the underlying home page.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const title = mode === 'practice' ? '练习 Prompt' : '每日 Prompt'

  const handleCopy = async () => {
    const ok = await copyToClipboard(manualUrl)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Backdrop click closes only when the click target is the overlay itself,
  // not a bubbled click from inside the dialog panel.
  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={handleOverlayClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
          ×
        </button>

        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p className={styles.tip}>复制后发给你的 AI 助手</p>

        <div className={styles.urlBox}>
          <a className={styles.urlLink} href={manualUrl} target="_blank" rel="noopener noreferrer">
            {manualUrl}
          </a>
          <button
            type="button"
            className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
            onClick={handleCopy}
            aria-label="复制手册地址到剪贴板"
          >
            {copied ? '已复制！' : '复制'}
          </button>
        </div>

        <button type="button" className={styles.confirmBtn} onClick={onConfirm}>
          确认开始游戏
        </button>
      </div>
    </div>
  )
}
