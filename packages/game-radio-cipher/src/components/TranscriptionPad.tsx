/**
 * 听写板 — the transcription pad. Per segment, the player types the syllables
 * they HEARD (free text, e.g. "hang zai"), then one-taps 复制给译码员 to copy a
 * composed report — 「段一，2 个音节，我听到：hang zai」 — to the clipboard to send
 * their AI/partner decoder.
 *
 * Hard rule: the pad NEVER auto-fills from the level data. Dictation is the
 * player's cognitive work; this is a notepad + composer only, so it takes the
 * segment's LABEL and syllable COUNT (both listener-visible) but never its
 * plaintext or ciphered content.
 */

import { useState } from 'react'

function composeReport(label: string, syllableCount: number, heard: string): string {
  const body = heard.trim() || '（还没填）'
  return `${label}，${syllableCount} 个音节，我听到：${body}`
}

export function TranscriptionPad({
  label,
  syllableCount,
}: {
  label: string
  syllableCount: number
}) {
  const [heard, setHeard] = useState('')
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')

  const message = composeReport(label, syllableCount, heard)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setStatus('copied')
      window.setTimeout(() => setStatus('idle'), 1800)
    } catch {
      // Clipboard blocked (non-secure context / permission) — reveal the text
      // so the player can select and copy it by hand.
      setStatus('manual')
    }
  }

  return (
    <div className="pad">
      <div className="pad-head">
        <span className="pad-title">听写板</span>
        <span className="pad-hint">把听到的音节打字记下（不用管意思）</span>
      </div>
      <div className="pad-row">
        <input
          className="pad-input"
          value={heard}
          placeholder="如 hang zai"
          aria-label={`${label} 听写`}
          onChange={(event) => {
            setHeard(event.target.value)
            if (status !== 'idle') setStatus('idle')
          }}
        />
        <button type="button" className="pad-copy" onClick={copy} disabled={!heard.trim()}>
          {status === 'copied' ? '已复制 ✓' : '复制给译码员'}
        </button>
      </div>
      {status === 'manual' && (
        <p className="pad-manual">
          自动复制被拦，手动选中这段发给译码员：<code>{message}</code>
        </p>
      )}
    </div>
  )
}
