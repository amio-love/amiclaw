import { useState } from 'react'
import styles from './TextPanel.module.css'

/** Client-side cap on a typed question — a botanist question is a short prompt,
 *  not an essay; the server enforces its own (larger) bound too. */
export const MAX_QUESTION_CHARS = 500

interface TextPanelProps {
  /** Send the typed question as a text-turn on the live session. */
  onSend: (text: string) => void
  /** Disabled until the session is live. */
  disabled: boolean
}

/* The typed-input fallback (FP1 A): 环境不便说话时打字问植物学家. Wired through the
   SAME botanist session as VoicePanel — the typed question rides a `text-turn`
   and the reply streams back on the shared socket. Presentation only. */
export default function TextPanel({ onSend, disabled }: TextPanelProps) {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed === '' || disabled) return
    onSend(trimmed)
    setText('')
  }

  return (
    <form
      className={styles.panel}
      aria-label="打字问植物学家"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        className={styles.input}
        type="text"
        value={text}
        disabled={disabled}
        maxLength={MAX_QUESTION_CHARS}
        placeholder="环境不便说话？打字问植物学家…"
        aria-label="给植物学家的问题"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className={styles.send} disabled={disabled || text.trim() === ''}>
        发送
      </button>
    </form>
  )
}
