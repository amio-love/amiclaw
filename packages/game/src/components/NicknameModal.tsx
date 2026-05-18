import { useId, useState, type FormEvent } from 'react'
import { NICKNAME_MAX_LENGTH, isValidNickname, setStoredNickname } from '@/utils/nickname'
import styles from './NicknameModal.module.css'

interface NicknameModalProps {
  open: boolean
  onConfirm: (nickname: string) => void
}

/**
 * Required first-submission gate for the daily leaderboard.
 *
 * Shown when `getStoredNickname()` returns null on a daily-mode ResultPage.
 * The modal is intentionally non-dismissable — there is no close button, Esc
 * does nothing, and clicking the backdrop does nothing — because the player
 * cannot post a score without a nickname. Once confirmed, the value is stored
 * in localStorage by this component and reused on subsequent daily runs.
 */
export default function NicknameModal({ open, onConfirm }: NicknameModalProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const descId = useId()

  if (!open) return null

  const trimmed = value.trim()
  const canConfirm = isValidNickname(value)

  const handleConfirm = () => {
    if (!canConfirm) return
    const ok = setStoredNickname(value)
    if (!ok) {
      setError('保存失败，请重试。')
      return
    }
    setError(null)
    onConfirm(trimmed)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    handleConfirm()
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId} className={styles.title}>
          给自己起个名字
        </h2>
        <p id={descId} className={styles.tip}>
          排行榜上需要一个能让朋友找到你的名字。最多 {NICKNAME_MAX_LENGTH} 字。
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            <span className={styles.labelText}>昵称</span>
            <input
              className={styles.input}
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                if (error) setError(null)
              }}
              maxLength={NICKNAME_MAX_LENGTH}
              autoFocus
            />
          </label>
          <div className={styles.meta}>
            <span className={styles.counter} aria-live="polite">
              {trimmed.length} / {NICKNAME_MAX_LENGTH}
            </span>
            {error && (
              <span className={styles.error} role="alert">
                {error}
              </span>
            )}
          </div>
          <button type="submit" className={styles.confirmBtn} disabled={!canConfirm}>
            确认
          </button>
        </form>
      </div>
    </div>
  )
}
